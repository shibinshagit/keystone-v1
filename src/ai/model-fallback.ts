import { ai } from './genkit';
import OpenAI from 'openai';

/**
 * Get OpenAI client only if API key is present
 */
function getOpenAIClient(): OpenAI {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is missing');
    }
    return new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
}

/**
 * Generate text with automatic fallback from OpenAI to Gemini
 * Tries OpenAI GPT-4o-mini first, falls back to Gemini on error or rate limit
 */
export async function generateWithFallback(prompt: string, preferredModel?: string): Promise<string> {
    try {
        if (preferredModel && preferredModel.includes('gemini')) {
            console.log('[Model Fallback] Preferred model is Gemini, skipping OpenAI.');
            throw new Error('Preferred model is Gemini');
        }

        const openai = getOpenAIClient();

        // Try OpenAI GPT-4o-mini first
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
        });

        return completion.choices[0]?.message?.content || '';
    } catch (openaiError: any) {
        console.warn('OpenAI failed, falling back to Gemini:', openaiError.message);

        // Fallback to Gemini
        try {
            const { text } = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt,
            });
            return text;
        } catch (geminiError: any) {
            console.error('Both OpenAI and Gemini failed:', geminiError.message);
            throw new Error(`All models failed. OpenAI: ${openaiError.message}, Gemini: ${geminiError.message}`);
        }
    }
}

/**
 * Generate with structured JSON output and automatic fallback
 */
export async function generateStructuredWithFallback<T>(
    prompt: string,
    responseFormat?: { type: 'json_object' } | { type: 'json_schema', json_schema: any }
): Promise<T> {
    try {
        const openai = getOpenAIClient();

        // Try OpenAI first with JSON mode
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a helpful assistant that responds in JSON format.' },
                { role: 'user', content: prompt }
            ],
            response_format: responseFormat || { type: 'json_object' },
            temperature: 0.7,
        });

        const content = completion.choices[0]?.message?.content || '{}';
        return JSON.parse(content) as T;
    } catch (openaiError: any) {
        console.warn('OpenAI structured generation failed, falling back to Gemini:', openaiError.message);

        // Fallback to Gemini (text-based JSON parsing)
        try {
            const { text } = await ai.generate({
                model: 'googleai/gemini-2.5-flash',
                prompt: prompt + '\n\nReturn ONLY valid JSON, no other text.',
            });

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in Gemini response');
            }
            return JSON.parse(jsonMatch[0]) as T;
        } catch (geminiError: any) {
            console.error('Both models failed for structured generation:', geminiError.message);
            throw new Error(`All models failed. OpenAI: ${openaiError.message}, Gemini: ${geminiError.message}`);
        }
    }
}
