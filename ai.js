const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pino = require("pino");
const http = require("http");

// Render mate chhotu HTTP server jethi port open rahe
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("MANN'S STORE WhatsApp AI Bot is Running 24/7!\n");
}).listen(PORT, () => {
    console.log(`🌍 HTTP Server running on port ${PORT}`);
});

const GEMINI_KEY = "AQ.Ab8RN6IROf8L6GnhW7XlE94Ld-EbgYYgRKwidHCP3gSw0EoFVg";
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR5LeChHO-tpBOHSxObs86uTvDUqoiIwWJ0181ir7UYvEhv03uU1minFQxkzRZ0rN0K_VqjnKRXM_R9/pub?output=csv";

let catalogText = "Loading catalog...";
const chatMemory = {};
const processedMsgIds = new Set();

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
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
        const res = await fetchWithTimeout(CSV_URL, {}, 10000);
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
    chatMemory[senderId].push(`Customer: ${userMsg}`);
    if (chatMemory[senderId].length > 8) chatMemory[senderId].shift();

    const systemRules = `Tu "MANN'S STORE" no polite, friendly ane smart human salesman che.
Customer sathe aadar sathe ("Sir" ke "Bhai" kahine) Gujarati, Hinglish, ke English ma natural manas ni jem vatchit kar.

SHOP DETAILS:
- Shop Name: MANN'S STORE
- Website: https://mannclothes.netlify.app
- Sizes Available: M, L, XL

LIVE STORE CATALOG:
${catalogText}

NIYAMO:
1. Customer dukan nu naam, kapda nu list, ke price puche to upar na catalog mathi sacho jawab aap.
2. Photo mange to namrata thi website link aap: https://mannclothes.netlify.app
3. Order karva mange to Name, Mobile Number, City ane Pincode mag.
4. Jawab chhoto ane WhatsApp chat jevo rakho. Fakt Salesman no j jawab lakhvo.`;

    const fullPrompt = `${systemRules}\n\nChat History:\n${chatMemory[senderId].join("\n")}\nSalesman:`;

    const geminiModels = [
        "gemini-flash-lite-latest",
        "gemini-flash-latest",
        "gemini-3.8-flash"
    ];

    for (const model of geminiModels) {
        try {
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
            }, 8000);

            const data = await res.json();
            if (data.error) continue;

            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (reply) {
                chatMemory[senderId].push(`Salesman: ${reply}`);
                return reply;
            }
        } catch (err) {}
    }

    try {
        const res = await fetchWithTimeout("https://text.pollinations.ai/openai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "openai",
                messages: [
                    { role: "system", content: systemRules },
                    { role: "user", content: `Chat History:\n${chatMemory[senderId].join("\n")}\n\nCustomer na chhella message no natural human salesman tarike jawab aap:` }
                ]
            })
        }, 8000);
        if (res.ok) {
            const data = await res.json();
            let reply = data.choices?.[0]?.message?.content?.trim();
            if (reply) {
                reply = reply.replace(/^Salesman:\s*/i, "");
                chatMemory[senderId].push(`Salesman: ${reply}`);
                return reply;
            }
        }
    } catch (e) {}

    return null;
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

                await sock.sendPresenceUpdate("composing", jid).catch(() => {});
                const reply = await askAI(jid, text);
                if (reply) {
                    await sock.sendMessage(jid, { text: reply });
                }
            } catch (err) {}
        }
    });
}

setInterval(loadCatalog, 5 * 60 * 1000);
startAIBot();
