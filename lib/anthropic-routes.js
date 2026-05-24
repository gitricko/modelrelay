/**
 * Anthropic Messages API routes for ModelRelay
 * These routes translate Anthropic requests to OpenAI-compatible format
 * and forward them internally to the OpenAI handler.
 *
 * The Anthropic provider is deliberately not exposed in `sources.js`
 * to avoid confusing the UI; these routes operate invisibly.
 */

import * as anthropicAdapter from './anthropic-adapter.js';

/**
 * Register Anthropic-specific routes on the Express app.
 * @param {import('express').Express} app
 * @param {number} port - The server's listening port (for loopback forwarding)
 */
export function setupAnthropicRoutes(app, port) {
  // Health check endpoint used by Claude CLI
  app.head('/', (req, res) => res.sendStatus(200));

  // Anthropic models list (GET /v1/models with anthropic-version header)
  app.get('/v1/models', (req, res, next) => {
    if (req.headers['anthropic-version']) {
      res.json(anthropicAdapter.buildAnthropicModelsList());
    } else {
      next(); // Not an Anthropic request, pass to OpenAI handler
    }
  });

  // Anthropic messages endpoint (POST /v1/messages)
  app.post('/v1/messages', async (req, res, next) => {
    if (!req.headers['anthropic-version']) {
      return next(); // Not for Anthropic; let other routes handle
    }

    try {
      // Translate Anthropic request to OpenAI format
      const openaiBody = anthropicAdapter.anthropicToOpenAI(req.body);

      // Prepare headers for the internal OpenAI request
      const openaiHeaders = {
        'Content-Type': 'application/json',
        'x-api-key': req.headers['x-api-key'] || '',
      };

      // Forward to the OpenAI endpoint (running on same port)
      const openaiRes = await fetch(`http://localhost:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: openaiHeaders,
        body: JSON.stringify(openaiBody),
      });

      if (!openaiRes.ok) {
        const err = await openaiRes.json();
        return res.status(openaiRes.status).json(err);
      }

      // If streaming response requested
      if (req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = openaiRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const transformer = anthropicAdapter.createAnthropicStreamTransformer(
          openaiBody.model,
          openaiBody._anthropicToolReverseMap
        );

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop(); // Keep incomplete line for next chunk

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const chunk = JSON.parse(data);
                const events = transformer.pushChunk(chunk);
                for (const event of events) {
                  res.write(`data: ${event}\n\n`);
                }
                if (transformer.done) {
                  res.end();
                  return;
                }
              } catch (e) {
                // Ignore malformed chunks
              }
            }
          }

          // Ensure we flush any remaining events (though transformer.done should have been set)
          res.end();
        } catch (err) {
          console.error('Anthropic streaming error:', err);
          res.end();
        } finally {
          reader.releaseLock();
        }
      } else {
        // Non-streaming response
        const openaiData = await openaiRes.json();
        const anthropicData = anthropicAdapter.openaiToAnthropic(
          openaiData,
          req.body.model,
          openaiBody._anthropicToolReverseMap
        );
        res.json(anthropicData);
      }
    } catch (error) {
      console.error('Anthropic /v1/messages error:', error);
      res.status(500).json({
        error: {
          message: 'Internal server error in Anthropic adapter',
          type: 'internal_server_error',
        },
      });
    }
  });
}
