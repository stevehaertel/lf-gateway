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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/run", async (req, res) => {
  const received = (req.header("x-api-key") || "").trim().replace(/:$/, "");
  if (received !== GATEWAY_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { input_value, session_id } = req.body || {};
  if (!input_value || typeof input_value !== "string") {
    return res.status(400).json({ error: "input_value is required" });
  }

  const url =
    `${DATASTAX_LANGFLOW_URL}/lf/${LANGFLOW_TENANT_ID}/api/v1/run/${FLOW_ID}?stream=false`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${APPLICATION_TOKEN}`,
        "X-DataStax-Current-Org": ASTRA_ORG_ID
      },
      body: JSON.stringify({
        input_value,
        input_type: "chat",
        output_type: "chat",
        ...(session_id ? { session_id } : {})
      })
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const answer =
      data?.outputs?.[0]?.outputs?.[0]?.results?.message?.text ??
      data?.outputs?.[0]?.outputs?.[0]?.results?.message ??
      "";

    return res.json({ answer, raw: data });
  } catch (err) {
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