import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1gb' }));
  app.use(express.urlencoded({ limit: '1gb', extended: true }));

  app.post("/api/proxy", async (req, res) => {
    try {
      const { endpoint, apiKey, payload } = req.body;
      
      if (endpoint && endpoint.startsWith("internal://gemini")) {
        const aiApiKey = process.env.GEMINI_API_KEY;
        if (!aiApiKey) throw new Error("Missing GEMINI_API_KEY in server environment.");
        const ai = new GoogleGenAI({ apiKey: aiApiKey });
        let reqModel = payload.model || "gemini-3.1-pro-preview";
        
        let systemInstruction = "";
        let chatContents = [];
        
        for (const msg of payload.messages || []) {
           if (msg.role === 'system') {
               systemInstruction += (systemInstruction ? "\n" : "") + msg.content;
           } else {
               let role = msg.role === 'assistant' ? 'model' : 'user';
               let parts = [];
               if (typeof msg.content === 'string') {
                   parts.push({ text: msg.content });
               } else if (Array.isArray(msg.content)) {
                   for (const c of msg.content) {
                       if (c.type === 'text') {
                           parts.push({ text: c.text });
                       } else if (c.type === 'image_url') {
                           const match = c.image_url.url.match(/^data:([^;]+)(?:;.*?)?;base64,(.+)$/);
                           if (match) {
                               parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                           }
                       }
                   }
               }
               chatContents.push({ role, parts });
           }
        }
        
        let mergedContents = [];
        for (const c of chatContents) {
            if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === c.role) {
                mergedContents[mergedContents.length - 1].parts.push(...c.parts);
            } else {
                mergedContents.push(c);
            }
        }
        
        const response = await ai.models.generateContent({
           model: reqModel,
           contents: mergedContents,
           config: {
               systemInstruction: systemInstruction ? systemInstruction : undefined,
               temperature: payload.temperature
           }
        });
        
        return res.json({
          choices: [{
            message: {
              role: 'assistant',
              content: response.text
            }
          }]
        });
      }

      let finalEndpoint = endpoint;
      let finalApiKey = apiKey;

      const response = await fetch(finalEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${finalApiKey}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
         const errText = await response.text();
         return res.status(response.status).json({ error: errText });
      }
      
      let data;
      const textToParse = await response.text();
      try {
        data = JSON.parse(textToParse);
      } catch (e: any) {
        return res.status(502).json({ error: `Invalid JSON from upstream: ${e.message}. Text: ${textToParse.substring(0, 100)}` });
      }
      res.json(data);
    } catch (error: any) {
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        res.status(502).json({ error: error.message, isNetworkError: true });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  app.post("/api/proxy/stream", async (req, res) => {
    try {
      const { endpoint, apiKey, payload } = req.body;
      
      if (endpoint && endpoint.startsWith("internal://gemini")) {
        const aiApiKey = process.env.GEMINI_API_KEY;
        if (!aiApiKey) throw new Error("Missing GEMINI_API_KEY in server environment.");
        const ai = new GoogleGenAI({ apiKey: aiApiKey });
        let reqModel = payload.model || "gemini-3.1-pro-preview";
        
        let systemInstruction = "";
        let chatContents = [];
        
        for (const msg of payload.messages || []) {
           if (msg.role === 'system') {
               systemInstruction += (systemInstruction ? "\n" : "") + msg.content;
           } else {
               let role = msg.role === 'assistant' ? 'model' : 'user';
               let parts = [];
               if (typeof msg.content === 'string') {
                   parts.push({ text: msg.content });
               } else if (Array.isArray(msg.content)) {
                   for (const c of msg.content) {
                       if (c.type === 'text') {
                           parts.push({ text: c.text });
                       } else if (c.type === 'image_url') {
                           const match = c.image_url.url.match(/^data:([^;]+)(?:;.*?)?;base64,(.+)$/);
                           if (match) {
                               parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                           }
                       }
                   }
               }
               chatContents.push({ role, parts });
           }
        }
        
        let mergedContents = [];
        for (const c of chatContents) {
            if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === c.role) {
                mergedContents[mergedContents.length - 1].parts.push(...c.parts);
            } else {
                mergedContents.push(c);
            }
        }
        
        const responseStream = await ai.models.generateContentStream({
           model: reqModel,
           contents: mergedContents,
           config: {
               systemInstruction: systemInstruction ? systemInstruction : undefined,
               temperature: payload.temperature
           }
        });
        
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        
        for await (const chunk of responseStream) {
           const text = chunk.text;
           if (text) {
               const out = { choices: [{ delta: { content: text } }] };
               res.write(`data: ${JSON.stringify(out)}\n\n`);
           }
        }
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      
      let finalEndpoint = endpoint;
      let finalApiKey = apiKey;

      const response = await fetch(finalEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${finalApiKey}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
         const errText = await response.text();
         return res.status(response.status).json({ error: errText });
      }
      
      res.setHeader("Content-Type", response.headers.get("Content-Type") || "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      if (!response.body) {
        return res.end();
      }

      const reader = response.body.getReader();
      const push = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } catch (e) {
          console.error("Stream error", e);
          res.end();
        }
      };
      push();
    } catch (error: any) {
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        res.status(502).json({ error: error.message, isNetworkError: true });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  app.post("/api/proxy/get", async (req, res) => {
      const { endpoint, apiKey } = req.body;
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          }
        });
        
        if (!response.ok) {
           const errText = await response.text();
           return res.status(response.status).json({ error: errText });
        }

        let data;
        const textToParse = await response.text();
        try {
          data = JSON.parse(textToParse);
        } catch (e: any) {
          return res.status(502).json({ error: `Invalid JSON from upstream: ${e.message}. Text: ${textToParse.substring(0, 100)}` });
        }
        res.json(data);
      } catch (error: any) {
        if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
          res.status(502).json({ error: error.message, isNetworkError: true });
        } else {
          res.status(500).json({ error: error.message });
        }
      }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : true
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
