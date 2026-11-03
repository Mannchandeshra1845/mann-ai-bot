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

// Render Environment Variable mathi key leshe (GitHub leak thi bachva mate)
let GEMINI_KEY = process.env.GEMINI_KEY || "";
let isGeminiKeyValid = Boolean(GEMINI_KEY);

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

    // 1. Try Gemini Models (Only if valid key is present in Render Environment)
    if (isGeminiKeyValid && GEMINI_KEY) {
        const geminiModels = [
            "gemini-2.5-flash",
            "gemini-flash-latest",
            "gemini-1.5-flash"
        ];

        for (const model of geminiModels) {
            try {
                console.log(`🔄 Trying Gemini model: ${model}`);
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
                const res = await fetchWithTimeout(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: fullPrompt }] }]
                    })
                }, 15000);

                const data = await res.json();
                if (data.error) {
                    console.log(`⚠️ Model ${model} error:`, data.error.message);
                    if (data.error.message.includes("API key not valid")) {
                        console.log("⚠️ Disabling invalid Gemini Key, switching permanently to Free AI Models...");
                        isGeminiKeyValid = false;
                        break;
                    }
                    continue;
                }

                const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (reply) {
                    console.log(`✅ Gemini Replied successfully using ${model}!`);
                    chatMemory[senderId].push(`Salesman: ${reply}`);
                    return reply;
                }
            } catch (err) {
                console.log(`⚠️ Model ${model} failed:`, err.message);
            }
        }
    }

    // 2. Multi-Model Free AI (No API Key Required - OpenAI & Mistral with 25s timeout)
    const freeModels = ["openai", "mistral"];
    for (const freeModel of freeModels) {
        try {
            console.log(`🔄 Trying Free AI Model (${freeModel})...`);
            const res = await fetchWithTimeout("https://text.pollinations.ai/openai", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: freeModel,
                    messages: [
                        { role: "system", content: systemRules },
                        { role: "user", content: `Chat History:\n${chatMemory[senderId].join("\n")}\n\nCustomer na chhella message no natural human salesman tarike jawab aap:` }
                    ]
                })
            }, 25000);

            if (res.ok) {
                const data = await res.json();
                let reply = data.choices?.[0]?.message?.content?.trim();
                if (reply) {
                    reply = reply.replace(/^Salesman:\s*/i, "");
                    console.log(`✅ Free AI (${freeModel}) Replied successfully!`);
                    chatMemory[senderId].push(`Salesman: ${reply}`);
                    return reply;
                }
            }
        } catch (e) {
            console.log(`⚠️ Free AI (${freeModel}) failed:`, e.message);
        }
    }

    // 3. Direct Fast GET Fallback
    try {
        console.log(`🔄 Trying Fast Direct AI Fallback...`);
        const directUrl = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}`;
        const res = await fetchWithTimeout(directUrl, { method: "GET" }, 25000);
        if (res.ok) {
            let reply = (await res.text()).trim();
            if (reply) {
                reply = reply.replace(/^Salesman:\s*/i, "");
                console.log(`✅ Fast Direct AI Replied successfully!`);
                chatMemory[senderId].push(`Salesman: ${reply}`);
                return reply;
            }
        }
    } catch (e) {
        console.log(`⚠️ Direct AI failed:`, e.message);
    }

    return "Namaste Bhai! MANN'S STORE ma tamaru swagat che. Amaro live catalog jovu hoy to https://mannclothes.netlify.app par visit karo athva tamare kaya kapda jova che te janavo!";
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
