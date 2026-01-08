# How to Find Your WhatsApp Business Account (WABA) ID

The WABA ID is required to fetch your approved message templates. Here's how to find it:

## Method 1: Meta Business Manager (Recommended)

1. Go to [Meta Business Suite](https://business.facebook.com/)
2. Click on **Settings** (gear icon in the bottom left)
3. Under **Accounts**, click **WhatsApp Accounts**
4. Select your WhatsApp Business Account
5. Your **WABA ID** will be displayed at the top of the page (it's a long number like `123456789012345`)

## Method 2: From the URL

1. Go to [Meta Business Suite](https://business.facebook.com/)
2. Navigate to your WhatsApp Account settings
3. Look at the URL in your browser - it will contain `waba_id=XXXXXXXXXX`
4. Copy the number after `waba_id=`

## Method 3: Using the API (Advanced)

If you have access to your Business Portfolio ID, you can query:
```
GET https://graph.facebook.com/v19.0/{BUSINESS_PORTFOLIO_ID}/owned_whatsapp_business_accounts
```

## Adding WABA_ID to Your .env File

Once you have your WABA ID, add it to your `.env` file:

```env
WABA_ID=your_waba_id_here
WHATSAPP_TOKEN=your_token_here
PHONE_NUMBER_ID=your_phone_number_id_here
```

## Example

```env
WABA_ID=123456789012345
WHATSAPP_TOKEN=EAABsbCS1iHsBO...
PHONE_NUMBER_ID=921833177678812
```

After adding the WABA_ID, restart your server for the changes to take effect.
