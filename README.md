# Meta Ads Tracker - OAuth Token Handler

A simple Node.js app to handle Meta (Facebook) OAuth flow and exchange authorization codes for long-lived access tokens.

## Features

- ✅ OAuth callback endpoint at `/meta/auth/callback`
- ✅ Automatic exchange of authorization code for access token
- ✅ Automatic exchange of short-lived token for long-lived token (~60 days)
- ✅ Token validation by fetching user's ad accounts
- ✅ **MongoDB Atlas integration** - Automatic token storage with timestamps
- ✅ Token retrieval endpoints with pagination
- ✅ Comprehensive Winston logging
- ✅ Error handling and validation
- ✅ Helper endpoint to generate OAuth URLs

## Quick Setup

### 1. Install Dependencies

```bash
cd meta-ads-tracking
npm install
```

### 2. Environment Configuration

Copy `env.example` to `.env` and fill in your Meta app credentials:

```bash
cp env.example .env
```

Edit `.env`:
```env
META_APP_ID=your_actual_app_id
META_APP_SECRET=your_actual_app_secret
META_REDIRECT_URI=https://piyush-meta-ads-tracker.vercel.com/meta/auth/callback
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/meta-ads-tracker?retryWrites=true&w=majority
PORT=3000
NODE_ENV=development
```

**MongoDB Atlas Setup:**
1. Create a free account at [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a new cluster
3. Create a database user with read/write permissions
4. Get your connection string and replace `username`, `password`, and `cluster` in the `MONGODB_URI`

### 3. Start the Server

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### 1. Health Check
```
GET /
```
Returns server status and timestamp.

### 2. Generate OAuth URL (Helper)
```
GET /meta/auth/url
```
Returns the OAuth URL to send to your clients.

**Response:**
```json
{
  "oauth_url": "https://www.facebook.com/v18.0/dialog/oauth?client_id=...",
  "message": "Send this URL to your client to authorize access"
}
```

### 3. OAuth Callback (Main Endpoint)
```
GET /meta/auth/callback?code=<authorization_code>
```

This is where Meta redirects after user authorization. **Automatically stores token in MongoDB.**

**Success Response:**
```json
{
  "success": true,
  "message": "OAuth authorization completed successfully",
  "data": {
    "token_id": "507f1f77bcf86cd799439011",
    "access_token": "long_lived_access_token_here",
    "token_type": "bearer",
    "expires_in": 5184000,
    "ad_accounts": [...],
    "timestamp": "2025-10-05T15:30:00.000Z"
  }
}
```

### 4. Get Stored Tokens
```
GET /meta/tokens?limit=10&skip=0
```

Retrieve stored tokens with pagination (access tokens are hidden for security).

**Response:**
```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "token_type": "bearer",
        "expires_in": 5184000,
        "timestamp": "2025-10-05T15:30:00.000Z",
        "created_at": "2025-10-05T15:30:00.000Z",
        "ad_accounts_count": 3,
        "status": "active"
      }
    ],
    "pagination": {
      "total": 15,
      "limit": 10,
      "skip": 0,
      "hasMore": true
    }
  }
}
```

### 5. Get Specific Token by ID
```
GET /meta/tokens/:tokenId?includeToken=true
```

Retrieve a specific token by its MongoDB ID. Use `includeToken=true` to include the actual access token.

**Error Response:**
```json
{
  "success": false,
  "error": "oauth_processing_failed",
  "description": "Failed to process OAuth callback",
  "details": "..."
}
```

## Usage Flow

1. **Get OAuth URL**: Call `GET /meta/auth/url` to get the authorization URL
2. **Send to Client**: Share the OAuth URL with your client
3. **Client Authorizes**: Client opens URL, approves permissions
4. **Receive Token**: Meta redirects to `/meta/auth/callback` with the long-lived token
5. **Store Token**: Use the returned access token to make Meta API calls

## Example OAuth URL

```
https://www.facebook.com/v18.0/dialog/oauth?
  client_id=YOUR_APP_ID&
  redirect_uri=https://piyush-meta-ads-tracker.vercel.com/meta/auth/callback&
  scope=ads_read,ads_management
```

## Logging

All activities are logged using Winston:
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only
- Console output with colors

## Token Storage

**Automatic MongoDB Storage**: All tokens are automatically stored in the `tokens` collection with the following structure:

```javascript
{
  _id: ObjectId("..."),
  access_token: "long_lived_token_here",
  token_type: "bearer",
  expires_in: 5184000,
  timestamp: new Date(),
  created_at: "2025-10-05T15:30:00.000Z",
  ad_accounts: [...], // Array of ad account objects
  ad_accounts_count: 3,
  client_info: {
    user_agent: "Mozilla/5.0...",
    ip_address: "192.168.1.1"
  },
  status: "active"
}
```

**Database Indexes**: Automatically creates indexes on `timestamp` and `client_id` for efficient queries.

## Deployment

### Vercel Deployment

1. Install Vercel CLI: `npm i -g vercel`
2. Deploy: `vercel --prod`
3. Set environment variables in Vercel dashboard

### Environment Variables for Production

Make sure to set these in your deployment platform:
- `META_APP_ID`
- `META_APP_SECRET` 
- `META_REDIRECT_URI`
- `MONGODB_URI` (your MongoDB Atlas connection string)
- `NODE_ENV=production`

## Security Notes

- Keep `META_APP_SECRET` secure and never expose it
- Use HTTPS in production
- Consider implementing rate limiting
- Store tokens securely (encrypted database)
- Validate redirect URIs match your Meta app settings

## Troubleshooting

### Common Issues

1. **"Invalid redirect URI"**: Make sure the redirect URI in your `.env` matches exactly what's configured in your Meta app
2. **"Invalid client_id"**: Check your `META_APP_ID` is correct
3. **"Invalid client_secret"**: Verify your `META_APP_SECRET` is correct
4. **Token expired**: Long-lived tokens last ~60 days, implement refresh logic

### Logs

Check the logs for detailed error information:
```bash
tail -f logs/combined.log
tail -f logs/error.log
```

## Next Steps

After getting the access token, you can use it to:
- Fetch campaigns: `GET /v18.0/{ad_account_id}/campaigns`
- Get ad insights: `GET /v18.0/{ad_id}/insights`
- Pull ad performance data
- Manage ad campaigns

Example API call with the token:
```javascript
const response = await axios.get(
  `https://graph.facebook.com/v18.0/act_${adAccountId}/campaigns`,
  { params: { access_token: longLivedToken } }
);
```
