import { Client, GatewayIntentBits, Partials, Events, ChannelType } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const GIO_SANG = process.env.GIO_SANG || "06:00";
const GIO_TOI = process.env.GIO_TOI || "19:00";
const FILE_PATH = "tkb_data.json";
const TIMEZONE = "Asia/Ho_Chi_Minh";

let autoDetectedRepo = null;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
});

const TEN_THU_VI = {
    "Monday": "Thứ 2",
    "Tuesday": "Thứ 3",
    "Wednesday": "Thứ 4",
    "Thursday": "Thứ 5",
    "Friday": "Thứ 6",
    "Saturday": "Thứ 7",
    "Sunday": "Chủ Nhật"
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ------------------------------------------------------------------
// TỰ ĐỘNG PHÁT HIỆN REPO TỪ GITHUB TOKEN
// ------------------------------------------------------------------
async function detectGithubRepo() {
    try {
        const userRes = await fetch("https://api.github.com/user", {
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "Discord-TKB-Bot"
            }
        });
        if (!userRes.ok) throw new Error("GITHUB_TOKEN không hợp lệ!");

        const reposRes = await fetch(`https://api.github.com/user/repos?sort=updated&per_page=1`, {
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "Discord-TKB-Bot"
            }
        });
        const reposData = await reposRes.json();
        if (!reposData || reposData.length === 0) throw new Error("Không tìm thấy Repo nào trong tài khoản GitHub!");

        autoDetectedRepo = reposData[0].full_name;
        console.log(`✅ Tự động nhận diện GitHub Repo: ${autoDetectedRepo}`);
    } catch (err) {
        console.error("❌ Lỗi tự nhận diện Repo:", err.message);
    }
}

// ------------------------------------------------------------------
// ĐỌC VÀ TỰ TẠO/GHI ĐÈ FILE TKB TRÊN GITHUB REPO
// ------------------------------------------------------------------
async function loadTkbFromGithub() {
    if (!autoDetectedRepo) await detectGithubRepo();
    try {
        const url = `https://api.github.com/repos/${autoDetectedRepo}/contents/${FILE_PATH}`;
        const res = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "Discord-TKB-Bot"
            }
        });

        if (!res.ok) return {};

        const data = await res.json();
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error("Lỗi khi tải TKB từ GitHub:", error.message);
        return {};
    }
}

async function saveTkbToGithub(data) {
    if (!autoDetectedRepo) await detectGithubRepo();
    try {
        const url = `https://api.github.com/repos/${autoDetectedRepo}/contents/${FILE_PATH}`;
        
        let sha = null;
        const getRes = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "Discord-TKB-Bot"
            }
        });
        if (getRes.ok) {
            const fileData = await getRes.json();
            sha = fileData.sha;
        }

        // Đã sửa thành 'base64' chuẩn cho GitHub API
        const contentBase64 = Buffer.from(JSON.stringify(data, null, 4)).toString('base64');

        const body = {
            message: "bot: tự động cập nhật tkb_data.json từ Discord",
            content: contentBase64,
            ...(sha && { sha })
        };

        const putRes = await fetch(url, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "Content-Type": "application/json",
                "User-Agent": "Discord-TKB-Bot"
            },
            body: JSON.stringify(body)
        });

        if (!putRes.ok) {
            const errData = await putRes.json();
            throw new Error(errData.message || putRes.statusText);
        }

        console.log("✅ Đã tạo/cập nhật file tkb_data.json lên GitHub thành công!");
        return true;
    } catch (error) {
        console.error("Lỗi khi lưu file lên GitHub:", error.message);
        throw error;
    }
}

// ------------------------------------------------------------------
// XỬ LÝ ẢNH BẰNG GEMINI AI
// ------------------------------------------------------------------
async function analyzeTkbWithAI(imageUrl, mimeType = 'image/png') {
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const prompt = `
    Hãy đọc hình ảnh Thời khóa biểu này và trả về dữ liệu dưới dạng JSON thuần túy.
    Định dạng JSON cần trả về chính xác như sau:
    {
        "Monday": "Tiết 1: Môn A\\nTiết 2: Môn B\\n...",
        "Tuesday": "Tiết 1: Môn C\\n...",
        "Wednesday": "...",
        "Thursday": "...",
        "Friday": "...",
        "Saturday": "...",
        "Sunday": "Nghỉ học"
    }
    Lưu ý: Chỉ liệt kê môn học theo thứ tự tiết 1, 2, 3, 4, 5 của từng thứ (từ Monday đến Saturday). Nếu không có lịch ghi "Nghỉ học".
    `;

    const aiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
            prompt,
            {
                inlineData: {
                    data: buffer.toString('base64'),
                    mimeType: mimeType
                }
            }
        ],
        config: {
            responseMimeType: "application/json"
        }
    });

    return JSON.parse(aiResponse.text);
}

// ------------------------------------------------------------------
// SỰ KIỆN BOT
// ------------------------------------------------------------------
client.once(Events.ClientReady, async () => {
    console.log(`✅ Bot đã kết nối và CHỈ nhận TKB qua nhắn tin riêng (DM): ${client.user.tag}`);
    await detectGithubRepo();
    setupCronJobs();
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // Chỉ xử lý tin nhắn riêng (DM)
    if (message.channel.type !== ChannelType.DM) return;

    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        const isImage = attachment.contentType?.startsWith('image/');

        if (isImage) {
            await message.channel.send("🤖 **Gemini AI** đang phân tích ảnh TKB bạn gửi riêng, vui lòng chờ chút...");

            try {
                const parsedTkb = await analyzeTkbWithAI(attachment.url, attachment.contentType);
                await saveTkbToGithub(parsedTkb);
                await message.channel.send("✅ **Đã đọc và cập nhật Thời khóa biểu lên GitHub thành công!**");
            } catch (error) {
                console.error("Lỗi xử lý TKB (DM):", error);
                await message.channel.send(`❌ Lỗi khi xử lý ảnh DM: ${error.message}`);
            }
        }
    }
});

// ------------------------------------------------------------------
// LỊCH TRÌNH THÔNG BÁO TỰ ĐỘNG (VN)
// ------------------------------------------------------------------
function setupCronJobs() {
    const [gioSang, phutSang] = GIO_SANG.split(':');
    const [gioToi, phutToi] = GIO_TOI.split(':');

    // 06:00 Sáng -> Thông báo TKB Hôm nay
    cron.schedule(`${phutSang} ${gioSang} * * *`, async () => {
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
        const dayKey = DAYS[now.getDay()];
        const thuToday = TEN_THU_VI[dayKey] || dayKey;
        
        const tkbData = await loadTkbFromGithub();
        const tkbContent = tkbData[dayKey] || "Chưa có dữ liệu TKB.";

        try {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
                await channel.send(`☀️ **THỜI KHÓA BIỂU HÔM NAY (${thuToday.toUpperCase()})**\n\n${tkbContent}`);
                console.log(`[${GIO_SANG} VN] Đã gửi TKB hôm nay (${thuToday})`);
            }
        } catch (err) {
            console.error("Lỗi gửi tin nhắn 06:00:", err.message);
        }
    }, { timezone: TIMEZONE });

    // 19:00 Tối -> Thông báo TKB Ngày mai
    cron.schedule(`${phutToi} ${gioToi} * * *`, async () => {
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);

        const tomorrowKey = DAYS[tomorrow.getDay()];
        const thuTomorrow = TEN_THU_VI[tomorrowKey] || tomorrowKey;

        const tkbData = await loadTkbFromGithub();
        const tkbContent = tkbData[tomorrowKey] || "Chưa có dữ liệu TKB.";

        try {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
                await channel.send(`🌙 **THỜI KHÓA BIỂU NGÀY MAI (${thuTomorrow.toUpperCase()})**\n\n${tkbContent}`);
                console.log(`[${GIO_TOI} VN] Đã gửi TKB ngày mai (${thuTomorrow})`);
            }
        } catch (err) {
            console.error("Lỗi gửi tin nhắn 19:00:", err.message);
        }
    }, { timezone: TIMEZONE });

    console.log(`Đã đặt lịch gửi TKB tự động ra server (Múi giờ VN): Sáng ${GIO_SANG} & Tối ${GIO_TOI}`);
}

client.login(DISCORD_TOKEN);
