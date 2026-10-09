const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------------------------------------------
// 1. KẾT NỐI MONGODB ATLAS & TỰ ĐỘNG KHỞI TẠO ADMIN
// -------------------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bim_ppm';

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ Đã kết nối MongoDB Atlas thành công!');
    
    // Tự động khởi tạo tài khoản Admin đầu tiên nếu CSDL chưa có
    const adminExists = await User.findOne({ email: 'bimthuylv@gmail.com' });
    if (!adminExists) {
      await User.create({
        fullName: 'Thủy LV (Admin)',
        email: 'bimthuylv@gmail.com',
        password: '123456',
        role: 'Admin',
        department: 'Ban Giám Đốc'
      });
      console.log('🎉 Đã khởi tạo tài khoản Admin mặc định: bimthuylv@gmail.com / 123456');
    }
  })
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// -------------------------------------------------------------------
// 2. SCHEMAS & MODELS (DATABASE STRUCTURE)
// -------------------------------------------------------------------

// User Schema
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, default: '123456' },
  role: { type: String, enum: ['Admin', 'Manager', 'Member'], default: 'Member' },
  department: String
});
const User = mongoose.model('User', userSchema);

// Project Schema
const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  managerEmail: String,
  approverL1Email: String,
  approverL2Email: String,
  customFields: [{
    key: String,       // VD: 'plannedQty'
    label: String,     // VD: 'Khối lượng kế hoạch'
    type: String       // 'number', 'text', 'date'
  }],
  createdAt: { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', projectSchema);

// Folder Schema (WBS)
const folderSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  parentFolderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  name: { type: String, required: true }
});
const Folder = mongoose.model('Folder', folderSchema);

// Task Schema
const taskSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  title: { type: String, required: true },
  assigneeEmail: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['To Do', 'In Progress', 'Submitted', 'L1 Approved', 'Completed', 'Rejected'], 
    default: 'To Do' 
  },
  customData: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now }
});
const Task = mongoose.model('Task', taskSchema);

// ReportData Schema
const reportDataSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  submittedByEmail: String,
  reviewedByEmail: String,
  status: String,
  note: String,
  reportCustomData: { type: Map, of: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
});
const ReportData = mongoose.model('ReportData', reportDataSchema);

// -------------------------------------------------------------------
// 3. API ROUTES
// -------------------------------------------------------------------

// Trang chủ kiểm tra Server Status
app.get('/', (req, res) => {
  res.send('🚀 BIM Enterprise PPM API Server (MongoDB) is running live!');
});

// Authentication
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.password !== password) {
      return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không chính xác!' });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Đổi mật khẩu
app.put('/api/change-password', async (req, res) => {
  try {
    const { userId, oldPassword, newPassword } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Người dùng không tồn tại!' });
    }

    if (user.password !== oldPassword) {
      return res.status(400).json({ success: false, message: 'Mật khẩu cũ không chính xác!' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Quản lý Users
app.get('/api/users', async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

app.post('/api/users', async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Module 1: Projects & Custom Fields
app.get('/api/projects', async (req, res) => {
  const projects = await Project.find({}).sort({ createdAt: -1 });
  res.json(projects);
});

app.post('/api/projects', async (req, res) => {
  const project = await Project.create(req.body);
  res.json({ success: true, project });
});

app.put('/api/projects/:id/custom-fields', async (req, res) => {
  const { customFields } = req.body;
  const project = await Project.findByIdAndUpdate(req.params.id, { customFields }, { new: true });
  res.json({ success: true, project });
});

// WBS Folders
app.get('/api/folders', async (req, res) => {
  const { projectId } = req.query;
  const folders = await Folder.find({ projectId });
  res.json(folders);
});

app.post('/api/folders', async (req, res) => {
  const folder = await Folder.create(req.body);
  res.json({ success: true, folder });
});

// Tasks
app.get('/api/tasks', async (req, res) => {
  const { projectId, assigneeEmail } = req.query;
  let query = {};
  if (projectId) query.projectId = projectId;
  if (assigneeEmail) query.assigneeEmail = assigneeEmail;

  const tasks = await Task.find(query).populate('folderId');
  res.json(tasks);
});

app.post('/api/tasks', async (req, res) => {
  const task = await Task.create(req.body);
  res.json({ success: true, task });
});

// Module 2: Report
app.post('/api/report/submit', async (req, res) => {
  const { taskId, submittedByEmail, note, customDataUpdate } = req.body;
  
  const task = await Task.findById(taskId);
  if (!task) return res.status(404).json({ message: 'Task không tồn tại' });

  if (customDataUpdate) {
    Object.keys(customDataUpdate).forEach(key => {
      task.customData.set(key, customDataUpdate[key]);
    });
  }
  task.status = 'Submitted';
  task.updatedAt = new Date();
  await task.save();

  const reportLog = await ReportData.create({
    taskId,
    projectId: task.projectId,
    submittedByEmail,
    status: 'Submitted',
    note,
    reportCustomData: customDataUpdate
  });

  res.json({ success: true, task, reportLog });
});

// Module 3: ReportData (Audit Logs & Approval)
app.get('/api/report-data', async (req, res) => {
  const { projectId } = req.query;
  let query = {};
  if (projectId) query.projectId = projectId;

  const reports = await ReportData.find(query).populate('taskId').sort({ createdAt: -1 });
  res.json(reports);
});

app.put('/api/report-data/:id/approve', async (req, res) => {
  const { action, reviewedByEmail } = req.body;
  
  const reportLog = await ReportData.findById(req.params.id);
  if (!reportLog) return res.status(404).json({ message: 'Không tìm thấy phiếu báo cáo' });

  const task = await Task.findById(reportLog.taskId);
  
  if (action === 'APPROVE') {
    if (task.status === 'Submitted') task.status = 'L1 Approved';
    else if (task.status === 'L1 Approved') task.status = 'Completed';
    reportLog.status = 'Approved';
  } else {
    task.status = 'Rejected';
    reportLog.status = 'Rejected';
  }

  reportLog.reviewedByEmail = reviewedByEmail;
  await task.save();
  await reportLog.save();

  res.json({ success: true, task, reportLog });
});

// Module 4: Summary BI
app.get('/api/summary/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const tasks = await Task.find({ projectId }).populate('folderId');
  const project = await Project.findById(projectId);

  const statusSummary = {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'Completed').length,
    submitted: tasks.filter(t => t.status === 'Submitted').length
  };

  const numericTotals = {};
  if (project && project.customFields) {
    project.customFields.filter(f => f.type === 'number').forEach(field => {
      numericTotals[field.key] = tasks.reduce((sum, t) => {
        const val = t.customData ? Number(t.customData.get(field.key) || 0) : 0;
        return sum + val;
      }, 0);
    });
  }

  res.json({ project, statusSummary, numericTotals, tasks });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
