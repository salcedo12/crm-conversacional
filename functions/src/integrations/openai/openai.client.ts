import OpenAI from 'openai';
import { env } from '../../config/env';

let _client: OpenAI | null = null;

/** Cliente OpenAI lazy — se instancia la primera vez que se usa */
export function getOpenAIClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: env.openaiApiKey() });
  }
  return _client;
}
