import { Client, GatewayIntentBits, Partials, Events, ChannelType } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// ID Discord của bạn (được quyền dùng bot)
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID || "1188753053898260531";

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

const MAP_NHAP_THU = {
    "2": "Monday", "thu 2": "Monday", "thứ 2": "Monday", "monday": "Monday", "mon": "Monday",
    "3": "Tuesday", "thu 3": "Tuesday", "thứ 3": "Tuesday", "tuesday": "Tuesday", "tue": "Tuesday",
    "4": "Wednesday", "thu 4": "Wednesday", "thứ 4": "Wednesday", "wednesday": "Wednesday", "wed": "Wednesday",
    "5": "Thursday", "thu 5": "Thursday", "thứ 5": "Thursday", "thursday": "Thursday", "thu": "Thursday",
    "6": "Friday", "thu 6": "Friday", "thứ 6": "Friday", "friday": "Friday", "fri": "Friday",
    "7": "Saturday", "thu 7": "Saturday", "thứ 7": "Saturday", "saturday": "Saturday", "sat": "Saturday",
    "cn": "Sunday", "chu nhat": "Sunday", "chủ nhật": "Sunday", "sunday": "Sunday", "sun": "Sunday"
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
    console.log(`✅ Bot đã kết nối (Chế độ riêng tư): ${client.user.tag}`);
    await detectGithubRepo();
    setupCronJobs();
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // 1. Chỉ nhận tin nhắn riêng (DM)
    if (message.channel.type !== ChannelType.DM) return;

    // 2. Kiểm tra chỉ cho phép chính bạn (ALLOWED_USER_ID) dùng bot
    if (ALLOWED_USER_ID && ALLOWED_USER_ID !== "ID_DISCORD_CỦA_BẠN" && message.author.id !== ALLOWED_USER_ID) {
        await message.channel.send("⛔ Bạn không có quyền sử dụng Bot này!");
        return;
    }

    const content = message.content.trim();

    // --------------------------------------------------------------
    // XỬ LÝ LỆNH !check
    // --------------------------------------------------------------
    if (content.toLowerCase().startsWith('!check')) {
        const query = content.slice(6).trim().toLowerCase();
        const tkbData = await loadTkbFromGithub();

        if (!tkbData || Object.keys(tkbData).length === 0) {
            await message.channel.send("⚠️ Chưa có dữ liệu TKB nào trên GitHub. Vui lòng gửi ảnh TKB trước!");
            return;
        }

        // Trường hợp 1: Tách danh sách theo dấu chấm phẩy (ví dụ: !check 2;3;4;5;6;7)
        if (query.includes(';')) {
            const listThu = query.split(';').map(item => item.trim());
            let replyText = "📅 **THỜI KHÓA BIỂU DỰA THEO YÊU CẦU:**\n\n";

            for (const item of listThu) {
                const dayKey = MAP_NHAP_THU[item];
                if (dayKey) {
                    const thuTen = TEN_THU_VI[dayKey];
                    const tkbMon = tkbData[dayKey] || "Nghỉ học / Chưa có thông tin";
                    replyText += `📌 **${thuTen.toUpperCase()}**:\n${tkbMon}\n───────────────────\n`;
                } else {
                    replyText += `❌ Không nhận diện được: "${item}"\n───────────────────\n`;
                }
            }
            await message.channel.send(replyText);
            return;
        }

        // Trường hợp 2: Kiểm tra 1 thứ đơn lẻ (ví dụ: !check 2, !check thứ 3)
        if (query && MAP_NHAP_THU[query]) {
            const dayKey = MAP_NHAP_THU[query];
            const thuTen = TEN_THU_VI[dayKey];
            const tkbMon = tkbData[dayKey] || "Nghỉ học / Chưa có thông tin";
            await message.channel.send(`📌 **THỜI KHÓA BIỂU ${thuTen.toUpperCase()}**:\n\n${tkbMon}`);
            return;
        }

        // Trường hợp 3: !check (không nhập tham số) -> Xem TKB hôm nay
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
        const todayKey = DAYS[now.getDay()];
        const thuToday = TEN_THU_VI[todayKey];
        const tkbToday = tkbData[todayKey] || "Nghỉ học / Chưa có thông tin";
        await message.channel.send(`☀️ **THỜI KHÓA BIỂU HÔM NAY (${thuToday.toUpperCase()})**:\n\n${tkbToday}`);
        return;
    }

    // --------------------------------------------------------------
    // XỬ LÝ GỬI ẢNH TKB
    // --------------------------------------------------------------
    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        const isImage = attachment.contentType?.startsWith('image/');

        if (isImage) {
            await message.channel.send("🤖 **Gemini AI** đang phân tích ảnh TKB, vui lòng chờ chút...");

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
