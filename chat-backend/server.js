// server.js - Dialogflow Backend for Render Deployment
const express = require('express');
const cors = require('cors');
const { SessionsClient } = require('@google-cloud/dialogflow');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:5000',
        'http://127.0.0.1:3000',
        'https://portfolio-chatbot-liard.vercel.app', // Replace with your Vercel frontend URL
        // Add any other domains you need
    ],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Environment variables validation
const requiredEnvVars = ['GOOGLE_PROJECT_ID'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingEnvVars);
    console.log('📝 Please set the following environment variables:');
    console.log('   - GOOGLE_PROJECT_ID: Your Dialogflow project ID');
    console.log('   - GOOGLE_APPLICATION_CREDENTIALS: Path to your service account JSON file (or set the JSON content in GOOGLE_CREDENTIALS_JSON)');
}

// Initialize Dialogflow client
let sessionClient;
const projectId = process.env.GOOGLE_PROJECT_ID;

try {
    // For Render deployment, you can either:
    // 1. Upload the service account JSON file and set GOOGLE_APPLICATION_CREDENTIALS
    // 2. Or paste the JSON content as an environment variable GOOGLE_CREDENTIALS_JSON
    
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        // Option 2: JSON content as environment variable
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        sessionClient = new SessionsClient({
            projectId: projectId,
            credentials: credentials
        });
    } else {
        // Option 1: Using service account file path
        sessionClient = new SessionsClient({
            projectId: projectId
        });
    }
    
    console.log('✅ Dialogflow client initialized successfully');
} catch (error) {
    console.error('❌ Failed to initialize Dialogflow client:', error.message);
}

// Health check endpoint
app.get('/health', (req, res) => {
    const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        dialogflowConnected: !!sessionClient,
        projectId: projectId ? 'configured' : 'missing'
    };
    
    res.json(healthStatus);
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Dialogflow Webhook Server',
        status: 'running',
        endpoints: {
            health: '/health',
            webhook: '/webhook'
        },
        timestamp: new Date().toISOString()
    });
});

// Main webhook endpoint
app.post('/webhook', async (req, res) => {
    try {
        const { message, sessionId, languageCode = 'en' } = req.body;

        // Validation
        if (!message) {
            return res.status(400).json({
                error: 'Message is required',
                fulfillmentText: 'Please provide a message to process.'
            });
        }

        if (!sessionId) {
            return res.status(400).json({
                error: 'Session ID is required',
                fulfillmentText: 'Session configuration error. Please refresh the page.'
            });
        }

        if (!sessionClient) {
            console.error('Dialogflow client not initialized');
            return res.status(500).json({
                error: 'Dialogflow service unavailable',
                fulfillmentText: 'The chatbot service is temporarily unavailable. Please try again later.'
            });
        }

        console.log(`📨 Processing message: "${message}" for session: ${sessionId}`);

        // Create session path
        const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionId);

        // Prepare the request
        const request = {
            session: sessionPath,
            queryInput: {
                text: {
                    text: message,
                    languageCode: languageCode,
                },
            },
        };

        // Send request to Dialogflow
        const [response] = await sessionClient.detectIntent(request);
        const result = response.queryResult;

        console.log(`🤖 Dialogflow response: "${result.fulfillmentText}"`);
        console.log(`🎯 Intent: ${result.intent ? result.intent.displayName : 'None'}`);
        console.log(`🎲 Confidence: ${result.intentDetectionConfidence}`);

        // Prepare response
        const botResponse = {
            fulfillmentText: result.fulfillmentText || "I'm sorry, I didn't understand that.",
            intent: result.intent ? result.intent.displayName : null,
            confidence: result.intentDetectionConfidence,
            parameters: result.parameters,
            sessionId: sessionId,
            languageCode: result.languageCode
        };

        // Add rich responses if available
        if (result.fulfillmentMessages && result.fulfillmentMessages.length > 0) {
            botResponse.richResponses = result.fulfillmentMessages;
        }

        res.json(botResponse);

    } catch (error) {
        console.error('❌ Webhook error:', error);
        
        let errorMessage = 'I encountered an error processing your request. Please try again.';
        let statusCode = 500;

        if (error.code === 3) { // INVALID_ARGUMENT
            errorMessage = 'Invalid request format. Please try again.';
            statusCode = 400;
        } else if (error.code === 7) { // PERMISSION_DENIED
            errorMessage = 'Authentication error. Please contact support.';
            statusCode = 403;
        } else if (error.code === 14) { // UNAVAILABLE
            errorMessage = 'Dialogflow service is temporarily unavailable.';
            statusCode = 503;
        }

        res.status(statusCode).json({
            error: error.message,
            fulfillmentText: errorMessage,
            timestamp: new Date().toISOString()
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        fulfillmentText: 'Something went wrong. Please try again later.'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        message: `The endpoint ${req.method} ${req.path} does not exist`,
        availableEndpoints: ['GET /', 'GET /health', 'POST /webhook']
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Dialogflow Webhook Server Started');
    console.log(`📍 Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🤖 Dialogflow Project: ${projectId || 'NOT SET'}`);
    console.log('📋 Available endpoints:');
    console.log('   - GET  /          - Server info');
    console.log('   - GET  /health    - Health check');
    console.log('   - POST /webhook   - Dialogflow webhook');
    
    if (!sessionClient) {
        console.log('⚠️  Warning: Dialogflow client not properly configured');
        console.log('   Make sure to set GOOGLE_PROJECT_ID and authentication credentials');
    }
});