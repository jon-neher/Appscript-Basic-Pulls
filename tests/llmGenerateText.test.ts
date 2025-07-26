import nock from 'nock';

// Must import after nock is configured for proper interception order.
import { generateText } from '../src/llm/index';


describe('generateText – OpenAI provider', () => {
  const OPENAI_API_KEY = 'test-api-key';

  beforeEach(() => {
    process.env.OPENAI_API_KEY = OPENAI_API_KEY;
    delete process.env.OPENAI_ENDPOINT;
    delete process.env.OPENAI_MODEL_ID;
  });

  afterEach(() => {
    nock.cleanAll();
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_ENDPOINT;
    delete process.env.OPENAI_MODEL_ID;
  });

  it('sends correct request with default options', async () => {
    const prompt = 'Hello world';

    const scope = nock('https://api.openai.com')
      .post('/v1/chat/completions', (body) => {
        // Shape assertions
        expect(body).toMatchObject({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1024,
        });
        return true;
      })
      .matchHeader('authorization', `Bearer ${OPENAI_API_KEY}`)
      .reply(200, {
        id: 'cmpl-test',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hi there!',
            },
          },
        ],
      });

    const result = await generateText(prompt);
    expect(result).toBe('Hi there!');

    scope.done();
  });

  it('honours custom opts and endpoint override', async () => {
    const prompt = 'Custom test';
    const endpoint = 'https://custom-openai.example.com/chat';

    // nock needs a hostname – extract from endpoint
    const { hostname, pathname } = new URL(endpoint);

    const scope = nock(`https://${hostname}`)
      .post(pathname, (body) => {
        expect(body).toMatchObject({
          model: 'gpt-4o',
          temperature: 0.55,
          max_tokens: 50,
        });
        return true;
      })
      .matchHeader('authorization', `Bearer ${OPENAI_API_KEY}`)
      .reply(200, {
        choices: [
          {
            message: { role: 'assistant', content: 'Custom reply' },
          },
        ],
      });

    const result = await generateText(prompt, {
      modelId: 'gpt-4o',
      temperature: 0.55,
      maxTokens: 50,
      endpoint,
    });

    expect(result).toBe('Custom reply');
    scope.done();
  });

  it('falls back to OPENAI_ENDPOINT env var when opts.endpoint is absent', async () => {
    const prompt = 'Env endpoint';
    const envEndpoint = 'https://enterprise-openai.company.com/v1/chat/completions';
    process.env.OPENAI_ENDPOINT = envEndpoint;

    const { hostname, pathname } = new URL(envEndpoint);

    const scope = nock(`https://${hostname}`)
      .post(pathname)
      .reply(200, {
        choices: [
          { message: { role: 'assistant', content: 'Env reply' } },
        ],
      });

    const result = await generateText(prompt);
    expect(result).toBe('Env reply');
    scope.done();
  });
});
