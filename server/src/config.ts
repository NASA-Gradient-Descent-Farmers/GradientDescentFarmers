// All settings come from environment variables (see .env.example). Nothing secret is written in the code.

export interface Config {
  port: number
  /** Twilio Auth Token: used only to check that a request really comes from Twilio. */
  authToken: string
  /** The exact public URL Twilio is configured to call (the tunnel URL + /whatsapp). Signatures are computed over it. */
  webhookUrl: string
  /** The YoliA website, linked from the replies. */
  siteUrl: string
  /** How long an idle conversation is remembered, in minutes. */
  sessionMinutes: number
}

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const missing = ['TWILIO_AUTH_TOKEN', 'PUBLIC_WEBHOOK_URL'].filter((name) => !env[name]?.trim())
  if (missing.length > 0) throw new ConfigError(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`)
  const webhookUrl = env.PUBLIC_WEBHOOK_URL!.trim()
  if (!/^https:\/\//.test(webhookUrl)) throw new ConfigError('PUBLIC_WEBHOOK_URL must be the https:// URL Twilio calls (your tunnel URL followed by /whatsapp).')
  const port = Number(env.PORT?.trim() || 3000)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('PORT must be a number between 0 and 65535.')
  const minutes = Number(env.SESSION_MINUTES?.trim() || 360)
  return {
    port,
    authToken: env.TWILIO_AUTH_TOKEN!.trim(),
    webhookUrl,
    siteUrl: env.YOLIA_SITE_URL?.trim() || 'https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers',
    sessionMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 360,
  }
}
