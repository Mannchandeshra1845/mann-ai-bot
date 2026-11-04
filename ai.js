const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const http = require("http");

const phoneNumber = "918401690936"; 

const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("MANN'S STORE WhatsApp AI Bot is Running 24/7!\n");
}).listen(PORT, () => {
    console.log(`🌍 HTTP Server running on port ${PORT}`);
});

const GEMINI_KEY = (process.env.GEMINI_KEY || "").trim();
console.log(`🔑 GEMINI_KEY Environment Status: ${GEMINI_KEY ? "Loaded Successfully ✅" : "Not Found (Using Free AI Models) ⚠️"}`);

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR5LeChHO-tpBOHSxObs86uTvDUqoiIwWJ0181ir7UYvEhv03uU1minFQxkzRZ0rN0K_VqjnKRXM_R9/pub?output=csv";

let catalogText = "Loading catalog...";
const chatMemory = {};
const processedMsgIds = new Set();

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

async function loadCatalog() {
    try {
        const res = await fetchWithTimeout(CSV_URL, {}, 15000);
        const text = await res.text();
        const lines = text.split("\n").filter(l => l.trim() !== "");
        let items = [];
        for (let i = 1; i < lines.length; i++) {
            let row = [], insideQuotes = false, val = "";
            for (let ch of lines[i]) {
                if (ch === '"') insideQuotes = !insideQuotes;
                else if (ch === ',' && !insideQuotes) { row.push(val); val = ""; }
                else val += ch;
            }
            row.push(val);
            const name = row[1]?.trim() || "";
            const category = row[2]?.trim() || "General";
            const price = row[3]?.trim().replace("₹", "") || "";
            if (name) items.push(`• ${name} (Category: ${category}) — Price: ₹${price}`);
        }
        if (items.length > 0) {
            catalogText = items.reverse().join("\n");
            console.log(`✅ Catalog Loaded (${items.length} items)`);
        }
    } catch (err) {
        console.log("⚠️ Catalog Fetch Skipped:", err.message);
    }
}

async function askAI(senderId, userMsg) {
    if (!chatMemory[senderId]) chatMemory[senderId] = [];
    chatMemory[senderId].push({ role: "user", content: userMsg });
    if (chatMemory[senderId].length > 10) chatMemory[senderId].shift();

    const systemRules = `You are a very smart, friendly, and natural human assistant and salesman for "MANN'S STORE".

SHOP DETAILS:
- Shop Name: MANN'S STORE
- Website / Catalog Link: https://mannclothes.netlify.app
- Sizes Available: M, L, XL

LIVE STORE INVENTORY / CATALOG:
${catalogText}

IMPORTANT SMART RULES:
1. Language: Reply in the EXACT language or style the user speaks or requests (Gujarati, Hindi, Marathi, English, or Hinglish). If the user asks to talk in Marathi, talk fluently in Marathi!
2. Smart Conversation: Directly and intelligently answer whatever the user asks. Never repeat the same greeting every time.
3. Store Queries: When asked about clothes, prices, or products, give accurate details from the LIVE STORE INVENTORY above.
4. Photos: When asked for photos/images, politely share: https://mannclothes.netlify.app
5. Orders: When the user wants to buy/order, ask for their Name, Mobile Number, City, and Pincode.
6. Keep replies concise, natural, and WhatsApp-friendly (2-4 lines unless listing products).`;

    const historyText = chatMemory[senderId]
        .map(m => `${m.role === "user" ? "Customer" : "Salesman"}: ${m.content}`)
        .join("\n");
    const fullPrompt = `${systemRules}\n\nConversation History:\n${historyText}\nSalesman:`;

    // 1. Try Gemini Models if GEMINI_KEY is set in Render Environment
    if (GEMINI_KEY) {
        const geminiModels = [
            "gemini-flash-latest",
            "gemini-2.5-flash",
            "gemini-flash-lite-latest"
        ];

        for (const model of geminiModels) {
            try {
                console.log(`🔄 Trying Gemini model: ${model}`);
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
                const res = await fetchWithTimeout(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-goog-api-key": GEMINI_KEY
                    },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: fullPrompt }] }]
                    })
                }, 15000);

                const data = await res.json();
                if (data.error) {
                    console.log(`⚠️ Gemini ${model} error:`, data.error.message);
                    if (data.error.message.includes("API key not valid")) break;
                    continue;
                }

                const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (reply) {
                    console.log(`✅ Gemini Replied successfully using ${model}!`);
                    chatMemory[senderId].push({ role: "assistant", content: reply });
                    return reply;
                }
            } catch (err) {
                console.log(`⚠️ Gemini ${model} failed:`, err.message);
            }
        }
    }

    // 2. Smart Multi-Model Free AI with Proper Role Memory & Rate-Limit Retry
    const freeModels = ["openai", "openai-fast", "mistral"];
    for (let i = 0; i < freeModels.length; i++) {
        const freeModel = freeModels[i];
        try {
            console.log(`🔄 Trying Free AI Model (${freeModel})...`);
            const res = await fetchWithTimeout("https://text.pollinations.ai/openai", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                },
                body: JSON.stringify({
                    model: freeModel,
                    seed: Math.floor(Math.random() * 1000000),
                    messages: [
                        { role: "system", content: systemRules },
                        ...chatMemory[senderId]
                    ]
                })
            }, 25000);

            if (res.ok) {
                const data = await res.json();
                let reply = data.choices?.[0]?.message?.content?.trim();
                if (reply) {
                    reply = reply.replace(/^Salesman:\s*/i, "");
                    console.log(`✅ Free AI (${freeModel}) Replied successfully!`);
                    chatMemory[senderId].push({ role: "assistant", content: reply });
                    return reply;
                }
            } else {
                console.log(`⚠️ Free AI (${freeModel}) HTTP Status: ${res.status} - waiting 3s before next model...`);
                await delay(3000);
            }
        } catch (e) {
            console.log(`⚠️ Free AI (${freeModel}) failed:`, e.message);
            await delay(2000);
        }
    }

    // 3. Direct Fast GET Fallback with Short Prompt & Seed
    try {
        console.log(`🔄 Trying Fast Direct AI Fallback...`);
        const shortPrompt = `You are MANN'S STORE salesman (Catalog: ${catalogText.replace(/\n/g, ", ")} | Web: https://mannclothes.netlify.app). Reply smartly in the user's language to: "${userMsg}"`;
        const directUrl = `https://text.pollinations.ai/${encodeURIComponent(shortPrompt)}?model=openai&seed=${Date.now()}`;
        const res = await fetchWithTimeout(directUrl, {
            method: "GET",
            headers: { "User-Agent": "Mozilla/5.0" }
        }, 20000);

        if (res.ok) {
            let reply = (await res.text()).trim();
            if (reply && !reply.includes("<!DOCTYPE html>")) {
                reply = reply.replace(/^Salesman:\s*/i, "");
                console.log(`✅ Fast Direct AI Replied successfully!`);
                chatMemory[senderId].push({ role: "assistant", content: reply });
                return reply;
            }
        }
    } catch (e) {
        console.log(`⚠️ Direct AI failed:`, e.message);
    }

    return "Haa bhai, bolo! Tamare MANN'S STORE ma kaya kapda ke price jova che? Amaro live catalog ahiya pan joi shako cho: https://mannclothes.netlify.app";
}

let sock = null;
async function startAIBot() {
    await loadCatalog();

    const { state, saveCreds } = await useMultiFileAuthState("baileys_auth_info");
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        keepAliveIntervalMs: 15000,
        connectTimeoutMs: 60000,
        syncFullHistory: false
    });

    if (!sock.authState.creds.registered) {
        await delay(4000);
        let num = phoneNumber.replace(/[^0-9]/g, "");
        let code = await sock.requestPairingCode(num);
        code = code?.match(/.{1,4}/g)?.join("-") || code;
        console.log(`\n========================================`);
        console.log(`📌 TMARO WHATSAPP PAIRING CODE: ${code}`);
        console.log(`========================================\n`);
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "open") {
            console.log("🤖 BOT 100% READY & ACTIVE!");
        } else if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) {
                setTimeout(startAIBot, 2000);
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
            try {
                if (!msg.message || msg.key.fromMe) continue;
                if (processedMsgIds.has(msg.key.id)) continue;
                processedMsgIds.add(msg.key.id);

                const jid = msg.key.remoteJid;
                if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast" || jid.includes("newsletter")) continue;

                const m = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message;
                const text = m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || "";
                if (!text.trim()) continue;

                console.log(`\n📩 Incoming Msg from ${jid}: ${text}`);
                await sock.sendPresenceUpdate("composing", jid).catch(() => {});
                
                const reply = await askAI(jid, text);
                if (reply) {
                    await sock.sendMessage(jid, { text: reply });
                    console.log(`📤 Reply Sent Successfully!`);
                }
            } catch (err) {
                console.log("⚠️ Msg Error:", err.message);
            }
        }
    });
}

setInterval(loadCatalog, 5 * 60 * 1000);
startAIBot();
