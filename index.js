const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------------------------------------------
// 1. KẾT NỐI MONGODB ATLAS
// -------------------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bim_ppm';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB Atlas thành công!'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// -------------------------------------------------------------------
// 2. ĐỊNH NGHĨA SCHEMAS & MODELS
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

// Project Schema (Chứa Custom Fields linh hoạt)
const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  managerEmail: String,
  approverL1Email: String,
  approverL2Email: String,
  // Lưu danh sách các trường tùy chỉnh (VD: Khối lượng kế hoạch, Ngày bắt đầu...)
  customFields: [{
    key: String,       // VD: 'plannedQty'
    label: String,     // VD: 'Khối lượng kế hoạch'
    type: String       // 'number', 'text', 'date'
  }],
  createdAt: { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', projectSchema);

// Folder (WBS) Schema
const folderSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  parentFolderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  name: { type: String, required: true }
});
const Folder = mongoose.model('Folder', folderSchema);

// Task Schema (Chứa CustomData dạng Map/JSON động)
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
  // CustomData cho phép lưu bất kỳ cột trường dữ liệu động nào
  customData: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now }
});
const Task = mongoose.model('Task', taskSchema);

// ReportData Schema (Lịch sử báo cáo & Phê duyệt)
const reportDataSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  submittedByEmail: String,
  reviewedByEmail: String,
  status: String, // 'Submitted', 'Approved', 'Rejected'
  note: String,
  reportCustomData: { type: Map, of: mongoose.Schema.Types.Mixed }, // Snapshot dữ liệu báo cáo
  createdAt: { type: Date, default: Date.now }
});
const ReportData = mongoose.model('ReportData', reportDataSchema);

// -------------------------------------------------------------------
// 3. HỆ THỐNG REST API CHO 4 MODULE
// -------------------------------------------------------------------

// Auth & Users
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, message: 'Sai email hoặc mật khẩu!' });
  }
  res.json({ success: true, user });
});

app.get('/api/users', async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

app.post('/api/users', async (req, res) => {
  const user = await User.create(req.body);
  res.json({ success: true, user });
});

// --- MODULE 1: PROJECT & WBS FOLDERS ---
app.get('/api/projects', async (req, res) => {
  const projects = await Project.find({}).sort({ createdAt: -1 });
  res.json(projects);
});

app.post('/api/projects', async (req, res) => {
  const project = await Project.create(req.body);
  res.json({ success: true, project });
});

// Thêm/Xóa Trường Tùy Chỉnh (Custom Field) cho Dự án
app.put('/api/projects/:id/custom-fields', async (req, res) => {
  const { customFields } = req.body;
  const project = await Project.findByIdAndUpdate(req.params.id, { customFields }, { new: true });
  res.json({ success: true, project });
});

// Quản lý Thư mục WBS
app.get('/api/folders', async (req, res) => {
  const { projectId } = req.query;
  const folders = await Folder.find({ projectId });
  res.json(folders);
});

app.post('/api/folders', async (req, res) => {
  const folder = await Folder.create(req.body);
  res.json({ success: true, folder });
});

// Tạo & Lấy Task thuộc Dự án (Module Project)
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

// --- MODULE 2: REPORT (Báo cáo trực tiếp từ người làm) ---
app.post('/api/report/submit', async (req, res) => {
  const { taskId, submittedByEmail, note, customDataUpdate } = req.body;
  
  const task = await Task.findById(taskId);
  if (!task) return res.status(404).json({ message: 'Task không tồn tại' });

  // Cập nhật CustomData thực tế vào Task
  if (customDataUpdate) {
    Object.keys(customDataUpdate).forEach(key => {
      task.customData.set(key, customDataUpdate[key]);
    });
  }
  task.status = 'Submitted';
  task.updatedAt = new Date();
  await task.save();

  // Lưu một bản ghi lịch sử vào ReportData
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

// --- MODULE 3: REPORTDATA (Kho xét duyệt & Lưu trữ Báo cáo) ---
app.get('/api/report-data', async (req, res) => {
  const { projectId } = req.query;
  let query = {};
  if (projectId) query.projectId = projectId;

  const reports = await ReportData.find(query)
    .populate('taskId')
    .sort({ createdAt: -1 });
  res.json(reports);
});

// Duyệt hoặc Từ chối Báo cáo (L1/L2 Approvers)
app.put('/api/report-data/:id/approve', async (req, res) => {
  const { action, reviewedByEmail, note } = req.body; // action: 'APPROVE' hoặc 'REJECT'
  
  const reportLog = await ReportData.findById(req.params.id);
  if (!reportLog) return res.status(404).json({ message: 'Không tìm thấy báo cáo' });

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
  reportLog.note = note;

  await task.save();
  await reportLog.save();

  res.json({ success: true, task, reportLog });
});

// --- MODULE 4: SUMMARY (Tổng hợp thông tin đa chiều) ---
app.get('/api/summary/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const tasks = await Task.find({ projectId }).populate('folderId');
  const project = await Project.findById(projectId);

  // Thống kê tổng số lượng task theo trạng thái
  const statusSummary = {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'Completed').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    submitted: tasks.filter(t => t.status === 'Submitted').length,
    rejected: tasks.filter(t => t.status === 'Rejected').length
  };

  // Tính tổng tổng tích lũy cho các trường kiểu Số (Numeric Custom Fields)
  const numericTotals = {};
  if (project && project.customFields) {
    project.customFields.filter(f => f.type === 'number').forEach(field => {
      numericTotals[field.key] = tasks.reduce((sum, t) => {
        const val = t.customData ? Number(t.customData.get(field.key) || 0) : 0;
        return sum + val;
      }, 0);
    });
  }

  res.json({
    project,
    statusSummary,
    numericTotals,
    tasks
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
