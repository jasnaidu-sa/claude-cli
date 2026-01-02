# Outlook Integration Setup Guide
## For Claude Code Manager - Email Ideas Kanban

This guide walks you through setting up Microsoft Outlook integration to import project ideas from email.

---

## Overview

**What This Integration Does:**
- Fetches emails from a specific sender address (e.g., ideas@yourdomain.com)
- Creates idea cards in the Ideas Kanban board
- Allows reviewing and approving ideas for autonomous development
- Links approved ideas to autonomous workflows

**Architecture:**
- **Electron Main Process**: OAuth authentication, token refresh, email fetching
- **Microsoft Graph API**: Email access via OAuth 2.0
- **electron-store**: Secure token storage
- **Ideas Kanban**: UI for managing imported ideas

---

## Prerequisites

1. **Microsoft Account** (personal or work/school)
2. **Azure Portal Access** (for app registration)
3. **Claude Code Manager** installed and running

---

## Step 1: Register Application in Azure Portal

### 1.1 Navigate to Azure Portal

1. Go to [Azure Portal](https://portal.azure.com/)
2. Sign in with your Microsoft account
3. Search for "Azure Active Directory" in the top search bar
4. Click on **Azure Active Directory** from the results

### 1.2 Create New App Registration

1. In the left sidebar, click **App registrations**
2. Click **+ New registration** at the top
3. Fill in the registration form:

   **Name**: `Claude Code Manager - Ideas Integration`

   **Supported account types**: Select one of:
   - **Personal Microsoft accounts only** (if using personal Outlook)
   - **Accounts in any organizational directory and personal Microsoft accounts** (recommended for flexibility)

   **Redirect URI**:
   - Type: **Public client/native (mobile & desktop)**
   - Value: `http://localhost:3847/callback`

4. Click **Register**

### 1.3 Note Your Application (Client) ID

After registration, you'll see the **Overview** page:
- Copy the **Application (client) ID** - you'll need this later
- Example: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

---

## Step 2: Configure API Permissions

### 2.1 Add Microsoft Graph Permissions

1. In your app registration, click **API permissions** in the left sidebar
2. Click **+ Add a permission**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Search for and add these permissions:
   - ✅ `Mail.Read` - Read user mail
   - ✅ `Mail.ReadBasic` - Read basic mail properties
   - ✅ `offline_access` - Maintain access to data (for refresh tokens)

6. Click **Add permissions**

### 2.2 Grant Consent (Optional but Recommended)

If you're an admin or the only user:
1. Click **Grant admin consent for [Your Tenant]**
2. Click **Yes** to confirm

If you're not an admin, users will see a consent screen on first login.

---

## Step 3: Authentication Configuration

### 3.1 Configure Authentication Settings

1. In your app registration, click **Authentication** in the left sidebar
2. Under **Platform configurations**, find your **Public client/native** entry
3. Verify the redirect URI is: `http://localhost:3847/callback`

### 3.2 Advanced Settings (Optional)

Under **Advanced settings**:
- **Allow public client flows**: Yes (enable)
- This allows the app to use device code flow if needed

---

## Step 4: Configure Claude Code Manager

### 4.1 Set Up Source Email Address

In the Claude Code Manager:

1. Open the **Ideas** view
2. Click the **Settings** (gear) icon
3. In the Outlook Configuration modal, enter:
   - **Azure App Client ID**: Paste your Application (client) ID
   - **Tenant ID**: Leave as `common` (works for personal and work accounts)
   - **Source Email Address**: The email address that will send ideas
     - Example: `ideas@yourdomain.com`
     - Only emails from this address will be imported as ideas

4. Click **Save Configuration**

### 4.2 Authenticate

1. Click the **Sync Emails** button
2. A browser window will open for Microsoft login
3. Sign in with your Microsoft account
4. Review and accept the permissions requested
5. The window will close automatically after successful authentication

---

## Step 5: Test the Integration

### 5.1 Send a Test Email

1. From your configured source email address (e.g., ideas@yourdomain.com)
2. Send an email to your Outlook account with:
   - **Subject**: Project idea title (e.g., "Add dark mode to dashboard")
   - **Body**: Description of the feature or idea

### 5.2 Sync and Verify

1. In Claude Code Manager, click **Sync Emails**
2. The email should appear as a new card in the **Inbox** column
3. You can now:
   - Move it to **Review** to discuss with AI
   - Approve it and set project type (greenfield/brownfield)
   - Start an autonomous workflow from the approved idea

---

## Configuration Reference

### Redirect URI

**What it is**: The URL Microsoft redirects to after authentication

**Our Value**: `http://localhost:3847/callback`
- Port `3847` is a local server spun up temporarily during OAuth
- The main process listens for the callback with the authorization code

### Scopes

The permissions we request from Microsoft:

| Scope | Purpose |
|-------|---------|
| `Mail.Read` | Read user's emails |
| `Mail.ReadBasic` | Read basic email metadata |
| `offline_access` | Get refresh tokens for background sync |

### Token Storage

Tokens are stored securely using electron-store:
- **Location**: `~/.config/Claude Code Manager/outlook-config.json` (encrypted)
- **Contents**:
  - `clientId` - Your Azure app client ID
  - `tenantId` - Usually "common"
  - `sourceEmailAddress` - Email to filter by
  - `accessToken` - Temporary access token (expires in 1 hour)
  - `refreshToken` - Long-lived token for getting new access tokens
  - `tokenExpiresAt` - When the access token expires

### Token Refresh

Tokens are automatically refreshed:
- **When**: Access token expires in less than 5 minutes
- **How**: Uses refresh token to get new access token
- **Fallback**: If refresh fails, user must re-authenticate

---

## Troubleshooting

### Error: "Outlook not configured"

**Solution**:
- Go to Ideas view → Settings icon
- Enter your Azure App Client ID
- Enter source email address
- Save configuration

### Error: "Authentication failed"

**Possible Causes**:
1. **Incorrect Client ID**: Verify the Application (client) ID from Azure Portal
2. **Redirect URI mismatch**: Ensure it's set to `http://localhost:3847/callback` in Azure
3. **Missing permissions**: Check API permissions in Azure Portal

**Solutions**:
1. Double-check the Client ID in both Azure Portal and Claude Code Manager
2. Recreate the app registration if needed
3. Grant admin consent for permissions

### Error: "No emails found"

**Possible Causes**:
1. No emails from the configured source address
2. Source email address doesn't match sender
3. Token expired or invalid

**Solutions**:
1. Send a test email from the exact source address configured
2. Check source email address matches exactly (case-sensitive)
3. Re-authenticate by clicking Sync Emails

### Error: "Token refresh failed"

**Possible Causes**:
1. Refresh token expired (revoked by user or Microsoft)
2. App registration deleted or disabled
3. Permissions revoked

**Solutions**:
1. Re-authenticate by clicking Sync Emails
2. Verify app registration still exists in Azure Portal
3. Check API permissions are still granted

---

## Security Best Practices

### ✅ DO:
- **Keep Client ID secure** (though it's not as sensitive as a secret)
- **Use encryption** for token storage (already handled by electron-store)
- **Request minimum permissions** (only Mail.Read, not Mail.ReadWrite)
- **Validate source email** to prevent importing spam as ideas
- **Monitor sync activity** for unusual patterns

### ❌ DON'T:
- **Share refresh tokens** with anyone
- **Commit tokens to git** (they're stored in user config, not repo)
- **Request excessive permissions** (we only need read access)
- **Store passwords** in the app (OAuth tokens only)

---

## Advanced Configuration

### Custom Sync Intervals

By default, emails are synced manually. To enable auto-sync:

1. The app checks for new emails only since the last sync
2. `lastSyncAt` timestamp tracks the last successful sync
3. Filters: `receivedDateTime ge [lastSyncAt]`

### Filtering Emails

Current filter: **From address only**
- Only emails from the configured source address are imported
- Subject and body are used as-is for idea title/description

**Future Enhancements** (not yet implemented):
- Filter by subject keywords
- Filter by importance level
- Skip emails with attachments
- Custom folder monitoring (currently hardcoded to inbox)

### Idea Deduplication

The system prevents duplicate ideas:
- Each email has a unique `messageId` from Microsoft
- `IdeasManager.createFromEmails()` checks if an idea already exists for each messageId
- Duplicate emails are skipped during import

---

## API Limits and Quotas

Microsoft Graph API limits:
- **Per-user limit**: 10,000 requests per 10 minutes
- **Batch size**: We fetch up to 50 emails per sync
- **Rate limiting**: Automatic backoff if hit (429 status)

Our implementation:
- Fetches max 50 emails per sync
- Filters by source address (reduces API calls)
- Only syncs since last sync time (incremental)

---

## Architecture Details

### OAuth Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    User clicks "Sync Emails"                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Main Process: OutlookIntegrationService.authenticate()     │
│  - Creates BrowserWindow                                    │
│  - Navigates to Microsoft OAuth URL                         │
│  - URL includes: client_id, redirect_uri, scopes            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               User authenticates with Microsoft              │
│  - Enters email/password                                    │
│  - Reviews permissions                                      │
│  - Clicks "Accept"                                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│        Microsoft redirects to: http://localhost:3847/callback│
│        with authorization code in query params               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Main Process intercepts redirect:                          │
│  - Captures authorization code from URL                     │
│  - Exchanges code for access_token + refresh_token          │
│  - Stores tokens in electron-store                          │
│  - Closes BrowserWindow                                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Authentication Complete                   │
│  - Status shown in UI: "Connected as user@email.com"       │
│  - Ready to sync emails                                     │
└─────────────────────────────────────────────────────────────┘
```

### Email Sync Flow

```
┌─────────────────────────────────────────────────────────────┐
│              User clicks "Sync Emails" button                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  OutlookService.fetchEmails()                               │
│  - Check token validity (refresh if needed)                 │
│  - Build Graph API filter: from/emailAddress/address eq     │
│    'ideas@yourdomain.com'                                   │
│  - Add date filter: receivedDateTime ge [lastSyncAt]        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Microsoft Graph API: GET /me/messages                      │
│  - Returns emails matching filter                           │
│  - Max 50 emails per request                                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  IdeasManager.createFromEmails()                            │
│  - For each email:                                          │
│    1. Check if idea already exists (by messageId)           │
│    2. Skip if duplicate                                     │
│    3. Create new idea with:                                 │
│       - title = subject                                     │
│       - description = body                                  │
│       - stage = 'inbox'                                     │
│       - emailSource metadata                                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              New idea cards appear in UI                     │
│  - Inbox column shows new ideas                             │
│  - User can review, approve, start workflows                │
└─────────────────────────────────────────────────────────────┘
```

---

## Next Steps After Setup

Once Outlook is connected and syncing:

1. **Review Ideas** - Move incoming ideas to Review stage for AI discussion
2. **Set Project Type** - Mark as greenfield (new) or brownfield (existing project)
3. **Approve** - Move to Approved stage when ready
4. **Start Workflow** - Click "Start Autonomous Workflow" to begin development
5. **Track Progress** - The workflow ID is linked back to the idea card

---

## Support

If you encounter issues:

1. Check the **Troubleshooting** section above
2. Review Azure Portal app registration settings
3. Check electron logs: `~/.config/Claude Code Manager/logs/`
4. Verify token storage: `~/.config/Claude Code Manager/outlook-config.json`

---

## Summary Checklist

- [ ] Azure app registration created
- [ ] Client ID copied
- [ ] API permissions configured (Mail.Read, offline_access)
- [ ] Redirect URI set to `http://localhost:3847/callback`
- [ ] Client ID entered in Claude Code Manager
- [ ] Source email address configured
- [ ] Successfully authenticated (green status indicator)
- [ ] Test email sent and synced
- [ ] Idea card appears in Inbox

✅ **You're all set!** Start sending ideas via email and manage them through the Kanban board.
