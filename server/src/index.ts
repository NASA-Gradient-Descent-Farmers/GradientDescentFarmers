import { ConfigError, loadConfig } from './config.ts'
import { loadResults } from './data.ts'
import { createWebhook, WEBHOOK_PATH } from './server.ts'

try {
  const config = loadConfig()
  const server = createWebhook(config, loadResults())
  server.listen(config.port, () => {
    console.log(`YolIA WhatsApp webhook listening on http://localhost:${config.port}${WEBHOOK_PATH}`)
    console.log(`Twilio must call: ${config.webhookUrl}`)
  })
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}
