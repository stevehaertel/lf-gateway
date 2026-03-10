const express = require("express");

const app = express();
app.use(express.json());

const {
  GATEWAY_API_KEY,
  DATASTAX_LANGFLOW_URL,
  LANGFLOW_TENANT_ID,
  FLOW_ID,
  ASTRA_ORG_ID,
  APPLICATION_TOKEN
} = process.env;

app.get("/", (_req, res) => {
  res.send("gateway alive");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/run", async (req, res) => {
  const received = (req.header("x-api-key") || "").trim().replace(/:$/, "");

  if (received !== GATEWAY_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { raw_user_input, session_id } = req.body || {};

  if (!raw_user_input || typeof raw_user_input !== "string") {
    return res.status(400).json({ error: "Missing required field: raw_user_input" });
  }

  console.log("Incoming raw_user_input:", raw_user_input);

  const url =
    `${DATASTAX_LANGFLOW_URL}/lf/${LANGFLOW_TENANT_ID}/api/v1/run/${FLOW_ID}?stream=true`;

  console.log("Calling Langflow URL:", url);
  console.log("Environment check:", {
    hasUrl: !!DATASTAX_LANGFLOW_URL,
    hasTenant: !!LANGFLOW_TENANT_ID,
    hasFlow: !!FLOW_ID,
    hasOrg: !!ASTRA_ORG_ID,
    hasToken: !!APPLICATION_TOKEN
  });

  // Check if client accepts streaming
  const acceptHeader = req.header("accept") || "";
  const wantsStreaming = acceptHeader.includes("text/event-stream");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${APPLICATION_TOKEN}`,
        "X-DataStax-Current-Org": ASTRA_ORG_ID
      },
      body: JSON.stringify({
        input_value: raw_user_input,
        input_type: "chat",
        output_type: "chat",
        ...(session_id ? { session_id } : {})
      })
    });

    console.log("Langflow status:", response.status);

    if (!response.ok) {
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      
      console.log("Langflow error response:", text);
      
      return res.status(response.status).json({
        error: "Langflow API error",
        status: response.status,
        response: data
      });
    }

    // If client wants streaming, stream the response
    if (wantsStreaming && response.body) {
      console.log("Streaming response to client");
      
      // Set headers for Server-Sent Events streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      try {
        // Stream the response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        let buffer = '';
        let eventCount = 0;
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            console.log(`Streaming complete. Total events: ${eventCount}`);
            break;
          }
          
          // Decode the chunk
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.trim()) {
              try {
                // Parse and forward the event
                const event = JSON.parse(line);
                eventCount++;
                
                // Forward as SSE
                res.write(`data: ${line}\n\n`);
                
                // Log event type
                if (eventCount % 10 === 0) {
                  console.log(`Streamed ${eventCount} events...`);
                }
              } catch (e) {
                console.error('Failed to parse event:', e);
              }
            }
          }
        }
        
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer);
            res.write(`data: ${buffer}\n\n`);
            eventCount++;
          } catch (e) {
            console.error('Failed to parse final event:', e);
          }
        }
        
        // End the stream
        res.end();
        
      } catch (streamError) {
        console.error('Streaming error:', streamError);
        res.write(`data: ${JSON.stringify({ event: 'error', data: { error: String(streamError) } })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming response (original behavior)
      console.log("Returning non-streaming response");
      
      const text = await response.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      const answer =
        data?.outputs?.[0]?.outputs?.[0]?.results?.message?.text ??
        data?.outputs?.[0]?.outputs?.[0]?.results?.message ??
        "";

      return res.json({
        answer,
        raw: data
      });
    }
    
  } catch (err) {
    console.error("Gateway failure:", err);
    return res.status(500).json({
      error: "Gateway failure",
      details: String(err)
    });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Gateway running on port ${port}`);
});

// Made with Bob
