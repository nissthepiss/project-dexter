# Brave + Puppeteer MCP Setup

## Quick Setup (One-Time)

1. **Run the launcher script:**
   ```bash
   launch-brave-debug.bat
   ```

2. **Log into your services** (Railway, GitHub, etc.) in this new Brave window
   - This is a separate profile, so your main Brave stays untouched
   - Cookies persist between sessions

3. **Keep this Brave window running** (minimize it)
   - Puppeteer connects to it in the background
   - No interference with your main browser

## How It Works

- The automation Brave runs on port 9222 (remote debugging)
- Your main Brave runs normally, completely separate
- Puppeteer MCP can read cookies/sessions from the automation profile
- Everything happens headlessly in the background

## Testing

Once Brave automation is running and you're logged into Railway:

```bash
node test-cookies-cdp.js
```

This will:
1. Connect to your automation Brave
2. Extract cookies
3. Launch a headless Puppeteer
4. Take a screenshot of Railway (logged in)

## Daily Usage

Just keep `launch-brave-debug.bat` running (or minimize it).
When you need Puppeteer to be logged into something:
1. Open the automation Brave window
2. Log into the service once
3. Puppeteer can now use those cookies

No more manual cookie exports, no extensions, completely seamless!
