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

    // Set headers for Server-Sent Events streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream the response from Langflow to the client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let buffer = '';
    let allEvents = [];
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
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
              // Parse the JSON event
              const event = JSON.parse(line);
              allEvents.push(event);
              
              // Forward the event to the client
              res.write(`data: ${line}\n\n`);
              
              console.log(`Streamed event: ${event.event}`);
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
          allEvents.push(event);
          res.write(`data: ${buffer}\n\n`);
        } catch (e) {
          console.error('Failed to parse final event:', e);
        }
      }
      
      console.log(`Streaming complete. Total events: ${allEvents.length}`);
      
      // End the stream
      res.end();
      
    } catch (streamError) {
      console.error('Streaming error:', streamError);
      res.write(`data: ${JSON.stringify({ event: 'error', data: { error: String(streamError) } })}\n\n`);
      res.end();
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
