require('dotenv').config();
const express = require('express');
const axios = require('axios');
const winston = require('winston');
const cors = require('cors');
const { MongoClient } = require('mongodb');

// Winston Logger Configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'meta-ads-tracker' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment variables validation
const requiredEnvVars = ['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI', 'MONGODB_URI'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Meta OAuth Configuration
const META_CONFIG = {
  APP_ID: process.env.META_APP_ID,
  APP_SECRET: process.env.META_APP_SECRET,
  REDIRECT_URI: process.env.META_REDIRECT_URI,
  API_VERSION: 'v18.0'
};

// MongoDB Configuration
let db;
let tokensCollection;

// Initialize MongoDB connection
async function initializeDatabase() {
  try {
    logger.info('Connecting to MongoDB Atlas...');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    
    db = client.db('meta-ads-tracker');
    tokensCollection = db.collection('tokens');
    
    // Create index on timestamp for efficient queries
    await tokensCollection.createIndex({ timestamp: -1 });
    await tokensCollection.createIndex({ client_id: 1 });
    
    logger.info('Successfully connected to MongoDB Atlas');
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error.message);
    process.exit(1);
  }
}

// Helper function to exchange authorization code for access token
async function exchangeCodeForToken(authCode) {
  try {
    logger.info('Exchanging authorization code for access token');
    
    const tokenUrl = `https://graph.facebook.com/${META_CONFIG.API_VERSION}/oauth/access_token`;
    const params = {
      client_id: META_CONFIG.APP_ID,
      redirect_uri: META_CONFIG.REDIRECT_URI,
      client_secret: META_CONFIG.APP_SECRET,
      code: authCode
    };

    const response = await axios.get(tokenUrl, { params });
    logger.info('Successfully received short-lived access token');
    
    return response.data;
  } catch (error) {
    logger.error('Error exchanging code for token:', error.response?.data || error.message);
    throw error;
  }
}

// Helper function to exchange short-lived token for long-lived token
async function exchangeForLongLivedToken(shortLivedToken) {
  try {
    logger.info('Exchanging short-lived token for long-lived token');
    
    const longLivedTokenUrl = `https://graph.facebook.com/${META_CONFIG.API_VERSION}/oauth/access_token`;
    const params = {
      grant_type: 'fb_exchange_token',
      client_id: META_CONFIG.APP_ID,
      client_secret: META_CONFIG.APP_SECRET,
      fb_exchange_token: shortLivedToken
    };

    const response = await axios.get(longLivedTokenUrl, { params });
    logger.info('Successfully received long-lived access token');
    
    return response.data;
  } catch (error) {
    logger.error('Error exchanging for long-lived token:', error.response?.data || error.message);
    throw error;
  }
}

// Helper function to test token and get user info
async function testToken(accessToken) {
  try {
    logger.info('Testing access token and fetching user ad accounts');
    
    const testUrl = `https://graph.facebook.com/${META_CONFIG.API_VERSION}/me/adaccounts`;
    const response = await axios.get(testUrl, {
      params: { access_token: accessToken }
    });
    
    logger.info(`Token is valid. Found ${response.data.data?.length || 0} ad accounts`);
    return response.data;
  } catch (error) {
    logger.error('Error testing token:', error.response?.data || error.message);
    throw error;
  }
}

// Helper function to save token to MongoDB
async function saveTokenToDatabase(tokenData, adAccountsData, clientInfo = {}) {
  try {
    logger.info('Saving token to MongoDB...');
    
    const tokenDocument = {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      timestamp: new Date(),
      created_at: new Date().toISOString(),
      ad_accounts: adAccountsData.data || [],
      ad_accounts_count: adAccountsData.data?.length || 0,
      client_info: {
        user_agent: clientInfo.userAgent || null,
        ip_address: clientInfo.ipAddress || null,
        ...clientInfo
      },
      status: 'active'
    };
    
    const result = await tokensCollection.insertOne(tokenDocument);
    logger.info('Token saved successfully', { 
      insertedId: result.insertedId,
      adAccountsCount: tokenDocument.ad_accounts_count 
    });
    
    return result.insertedId;
  } catch (error) {
    logger.error('Error saving token to database:', error.message);
    throw error;
  }
}

// Routes

// Health check endpoint
app.get('/', (req, res) => {
  logger.info('Health check endpoint accessed');
  res.json({ 
    status: 'OK', 
    message: 'Meta Ads Tracker API is running',
    timestamp: new Date().toISOString()
  });
});

// Generate OAuth URL endpoint (helper for clients)
app.get('/meta/auth/url', (req, res) => {
  try {
    const scopes = 'ads_read';
    const oauthUrl = `https://www.facebook.com/${META_CONFIG.API_VERSION}/dialog/oauth?` +
      `client_id=${META_CONFIG.APP_ID}&` +
      `redirect_uri=${encodeURIComponent(META_CONFIG.REDIRECT_URI)}&` +
      `scope=${scopes}`;
    
    logger.info('Generated OAuth URL for client');
    res.json({ 
      oauth_url: oauthUrl,
      message: 'Send this URL to your client to authorize access'
    });
  } catch (error) {
    logger.error('Error generating OAuth URL:', error.message);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});


// Main OAuth callback endpoint
app.get('/meta/auth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  
  logger.info('OAuth callback received', { 
    hasCode: !!code, 
    hasError: !!error,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  // Handle OAuth errors
  if (error) {
    logger.error('OAuth error received:', { error, error_description });
    return res.status(400).json({
      success: false,
      error: error,
      description: error_description || 'OAuth authorization failed'
    });
  }

  // Handle missing authorization code
  if (!code) {
    logger.error('No authorization code received in callback');
    return res.status(400).json({
      success: false,
      error: 'missing_code',
      description: 'Authorization code not found in callback'
    });
  }

  try {
    // Step 1: Exchange authorization code for short-lived token
    const shortLivedTokenData = await exchangeCodeForToken(code);
    
    // Step 2: Exchange short-lived token for long-lived token
    const longLivedTokenData = await exchangeForLongLivedToken(shortLivedTokenData.access_token);
    
    // Step 3: Test the token and get ad accounts
    const adAccountsData = await testToken(longLivedTokenData.access_token);
    
    // Log success
    logger.info('OAuth flow completed successfully', {
      tokenType: longLivedTokenData.token_type,
      expiresIn: longLivedTokenData.expires_in,
      adAccountsCount: adAccountsData.data?.length || 0
    });

    // Store the token in MongoDB
    const clientInfo = {
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip
    };
    const tokenId = await saveTokenToDatabase(longLivedTokenData, adAccountsData, clientInfo);
    
    // Return success response
    res.json({
      success: true,
      message: 'OAuth authorization completed successfully',
      data: {
        token_id: tokenId,
        access_token: longLivedTokenData.access_token,
        token_type: longLivedTokenData.token_type,
        expires_in: longLivedTokenData.expires_in,
        ad_accounts: adAccountsData.data,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('OAuth callback processing failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'oauth_processing_failed',
      description: 'Failed to process OAuth callback',
      details: error.response?.data || error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'internal_server_error',
    description: 'An unexpected error occurred'
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn('404 - Route not found:', req.path);
  res.status(404).json({
    success: false,
    error: 'not_found',
    description: 'Route not found'
  });
});

// Start server with database initialization
async function startServer() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    // Start Express server
    app.listen(PORT, () => {
      logger.info(`Meta Ads Tracker server running on port ${PORT}`);
      logger.info('Environment:', process.env.NODE_ENV || 'development');
      logger.info('OAuth Redirect URI:', META_CONFIG.REDIRECT_URI);
      logger.info('MongoDB connection: Ready');
    });
  } catch (error) {
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// Start the application
startServer();

module.exports = app;