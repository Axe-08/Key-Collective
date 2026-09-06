# 2-Minute Pitch & Demo Script

**Context:** Pitching to a fellow developer at a meetup.

**Speaker:** "How many OpenAI, Gemini, or Groq keys do you have scattered across `.env` files right now? If you're like me, you have a dozen from different hackathons and accounts. One hits a rate limit, while the others sit idle."

*(Screen shows a standard Python script failing with a 429 Rate Limit error)*

**Speaker:** "This is what happens when a single key bursts. But what if all your keys acted as one massive, resilient pool? Meet Key Collective."

*(Switches to Key Collective Dashboard. Shows 22 keys loaded. Total RPM capacity: 405)*

**Speaker:** "I deploy this single Go binary to Railway for free. I give my app ONE master token, and point it at this URL."

*(Switches back to Python script. Changes base_url and runs a massive concurrent batch of 100 requests. Terminal lights up green with fast responses.)*

**Speaker:** "Key Collective intercepts the requests. It knows which keys are healthy, which have RPM headroom, and which are fastest. If one hits a 429, the circuit breaker trips, isolates that key for 60 seconds, and seamlessly retries with the next one. Zero dropped requests. Zero idle capacity."
