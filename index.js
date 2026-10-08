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

let auth;
try {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
} catch (e) {
  console.error("Lỗi Google Auth:", e.message);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SYSTEM_EMAIL || ADMIN_EMAIL,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

app.get('/', (req, res) => {
  res.send('BIM Task System Backend with RBAC is running!');
});

// 1. API ĐĂNG NHẬP
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A2:F',
    });

    const rows = response.data.values || [];
    const user = rows.find(r => r[2] && r[2].trim().toLowerCase() === email.trim().toLowerCase());

    if (!user) {
      return res.status(401).json({ success: false, message: 'Email không tồn tại trên hệ thống!' });
    }

    const userPassword = user[3] || '123456';
    if (userPassword !== password) {
      return res.status(401).json({ success: false, message: 'Mật khẩu không chính xác!' });
    }

    res.json({
      success: true,
      user: {
        id: user[0],
        fullName: user[1],
        email: user[2],
        role: user[4] || 'Member',
        department: user[5] || 'BIM Team'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. API TẢI DANH SÁCH CÔNG VIỆC
app.get('/api/tasks', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Tasks!A2:J',
    });

    const rows = response.data.values || [];
    const today = new Date().toISOString().split('T')[0];

    const tasks = rows.map((row, index) => {
      let status = row[8] || 'Pending';
      const dueDate = row[7] || '';
      if (status !== 'Completed' && dueDate && dueDate < today) {
        status = 'Overdue';
      }

      return {
        rowIndex: index + 2,
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

// 3. API GIAO VIỆC MỚI (Admin / Manager)
app.post('/api/tasks', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const { title, assignee, assigneeEmail, project, priority, startDate, dueDate } = req.body;
    const newId = 'TSK-' + Date.now().toString().slice(-4);

    const values = [[
      newId, title, assignee, assigneeEmail, project, priority || 'Trung bình', startDate, dueDate, 'Pending', 0
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

// 4. API CẬP NHẬT TRẠNG THÁI CÔNG VIỆC
app.put('/api/tasks/status', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const { rowIndex, newStatus } = req.body;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Tasks!I${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[newStatus]] },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. API TẢI DANH SÁCH USERS
app.get('/api/users', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A2:F',
    });

    const rows = response.data.values || [];
    const users = rows.map((row) => ({
      id: row[0],
      fullName: row[1],
      email: row[2],
      role: row[4] || 'Member',
      department: row[5] || 'BIM Team',
    }));

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. API THÊM USER MỚI (Dành riêng cho Admin)
app.post('/api/users', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const { fullName, email, password, role, department } = req.body;
    const userId = 'USR-' + Date.now().toString().slice(-4);

    const values = [[userId, fullName, email, password || '123456', role || 'Member', department || 'BIM Team']];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Users!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });

    res.json({ success: true, userId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. CRONJOB CẢNH BÁO TRỄ HẠN
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
          subject: `[CẢNH BÁO TRỄ HẠN] Công việc: ${title}`,
          html: `<h3>Cảnh báo trễ hạn!</h3><p>Chào <b>${assignee}</b>,</p><p>Công việc <b>${title}</b> đã quá hạn từ ngày <b>${dueDate}</b>.</p>`,
        });
      }
    }
  } catch (err) {
    console.error('Lỗi Cronjob:', err);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
