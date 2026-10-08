const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

const SPREADSHEET_ID = '1I279Ll2_sC12dx-LAAL4evlGZ_QGtJGxJmarxl52ToA';
const ADMIN_EMAIL = 'bimthuylv@gmail.com';

// Khởi tạo Google Sheets Auth
let auth;
try {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} catch (e) {
  console.error("Lỗi parse GOOGLE_SERVICE_ACCOUNT_JSON:", e.message);
}

// Khởi tạo Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SYSTEM_EMAIL || ADMIN_EMAIL,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// Trang chủ kiểm tra Server
app.get('/', (req, res) => {
  res.send('BIM Task Management Backend API is running!');
});

// 1. API Lấy danh sách nhiệm vụ từ Google Sheet
app.get('/api/tasks', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Tasks!A2:J',
    });

    const rows = response.data.values || [];
    const today = new Date().toISOString().split('T')[0];

    const tasks = rows.map((row) => {
      let status = row[8] || 'Pending';
      const dueDate = row[7] || '';
      if (status !== 'Completed' && dueDate && dueDate < today) {
        status = 'Overdue';
      }

      return {
        id: row[0],
        title: row[1],
        assignee: row[2],
        assigneeEmail: row[3],
        project: row[4],
        priority: row[5],
        startDate: row[6],
        dueDate: dueDate,
        status: status,
        progress: Number(row[9] || 0),
      };
    });

    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. API Giao việc mới (Tự động lưu vào Google Sheet)
app.post('/api/tasks', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const { title, assignee, assigneeEmail, project, priority, startDate, dueDate } = req.body;
    const newId = 'TSK-' + Date.now().toString().slice(-4);

    const values = [[
      newId, title, assignee, assigneeEmail, project, priority, startDate, dueDate, 'Pending', 0
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Tasks!A:J',
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });

    res.json({ success: true, id: newId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. CRONJOB: Cảnh báo trễ hạn lúc 8h sáng hàng ngày
cron.schedule('0 8 * * *', async () => {
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Tasks!A2:J',
    });

    const rows = response.data.values || [];
    const today = new Date().toISOString().split('T')[0];

    for (const row of rows) {
      const title = row[1];
      const assignee = row[2];
      const assigneeEmail = row[3];
      const dueDate = row[7];
      const status = row[8];

      if (status !== 'Completed' && dueDate && dueDate < today && assigneeEmail) {
        await transporter.sendMail({
          from: `"BIM Task System" <${ADMIN_EMAIL}>`,
          to: assigneeEmail,
          subject: `[CANH BAO TRE HAN] Cong viec: ${title}`,
          html: `<h3>Canh bao cong viec qua han!</h3><p>Chao <b>${assignee}</b>,</p><p>Nhiem vu <b>${title}</b> qua han tu <b>${dueDate}</b>.</p>`,
        });
      }
    }
  } catch (err) {
    console.error('Lỗi Cronjob:', err);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
