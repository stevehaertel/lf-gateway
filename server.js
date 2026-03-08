const express = require("express");

const app = express();
app.use(express.json());

const {
  GATEWAY_API_KEY,
  DPH_API_URL,
  DPH_API_KEY
} = process.env;

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/run", async (req, res) => {
  const received = (req.header("x-api-key") || "").trim().replace(/:$/, "");

  console.log("----- Incoming GPT Request -----");
  console.log("Headers x-api-key present:", !!req.header("x-api-key"));
  console.log("Body:", JSON.stringify(req.body, null, 2));

  if (received !== GATEWAY_API_KEY) {
    console.log("Unauthorized gateway request");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { path, method = "GET", body } = req.body || {};

    if (!path || typeof path !== "string") {
      return res.status(400).json({ error: "Missing required field: path" });
    }

    const url = `${DPH_API_URL}${path}`;

    console.log("----- Outbound DPH Request -----");
    console.log("Method:", method);
    console.log("URL:", url);
    console.log("Body:", JSON.stringify(body || {}, null, 2));

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DPH_API_KEY}`
      },
      body: method === "GET" ? undefined : JSON.stringify(body || {})
    });

    const text = await response.text();

    console.log("----- DPH Response -----");
    console.log("Status:", response.status);
    console.log("Response body:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "DPH API client/server error",
        dph_status: response.status,
        dph_response: data
      });
    }

    return res.json({
      ok: true,
      dph_status: response.status,
      data
    });
  } catch (err) {
    console.log("Gateway failure:", err);
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
