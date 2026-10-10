const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'BIM_PPM_ENTERPRISE_SECRET_KEY_2026';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bim_ppm';

// 1. KẾT NỐI MONGODB ATLAS & KHỞI TẠO TÀI KHOẢN MẶC ĐỊNH
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ Đã kết nối MongoDB Atlas thành công!');
    
    const adminExists = await User.findOne({ email: 'bimthuylv@gmail.com' });
    if (!adminExists) {
      await User.create({
        fullName: 'Thủy LV (Admin)',
        email: 'bimthuylv@gmail.com',
        password: '123456',
        role: 'Admin',
        department: 'Ban Giám Đốc'
      });
    }

    const managerExists = await User.findOne({ email: 'manager@bim.com' });
    if (!managerExists) {
      await User.create({
        fullName: 'Nguyễn Văn Quản Lý',
        email: 'manager@bim.com',
        password: '123456',
        role: 'Manager',
        department: 'Ban Quản Lý Dự Án'
      });
    }

    const memberExists = await User.findOne({ email: 'member@bim.com' });
    if (!memberExists) {
      await User.create({
        fullName: 'Trần Văn Kỹ Sư',
        email: 'member@bim.com',
        password: '123456',
        role: 'Member',
        department: 'Phòng Thiết Kế'
      });
    }
  })
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// 2. SCHEMAS & MODELS
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, default: '123456' },
  role: { type: String, enum: ['Admin', 'Manager', 'Member'], default: 'Member' },
  department: String
});
const User = mongoose.model('User', userSchema);

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  managerEmail: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', projectSchema);

const taskSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  title: { type: String, required: true, default: 'Công việc mới' },
  assigneeEmail: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['To Do', 'In Progress', 'Submitted', 'L1 Approved', 'Completed', 'Rejected'], 
    default: 'To Do' 
  },
  startDate: { type: String, default: () => new Date().toISOString().split('T')[0] },
  finishDate: { type: String, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] },
  duration: { type: Number, default: 7 },
  planQty: { type: Number, default: 100 },
  approvedQty: { type: Number, default: 0 },
  indentLevel: { type: Number, default: 0 },
  orderIndex: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});
const Task = mongoose.model('Task', taskSchema);

const reportDataSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  submittedByEmail: String,
  reviewedByL1Email: String,
  reviewedByL2Email: String,
  status: { type: String, enum: ['Submitted', 'L1 Approved', 'Completed', 'Rejected'] },
  note: String,
  work: { type: Number, default: 0 },
  actual: { type: Number, default: 0 },
  assess: { type: Number, default: 0 },
  remain: { type: Number, default: 0 },
  rebar: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const ReportData = mongoose.model('ReportData', reportDataSchema);

// 3. MIDDLEWARE PHÂN QUYỀN JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Thiếu Token xác thực đăng nhập!' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn!' });
    req.user = user;
    next();
  });
};

const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: `Bị từ chối! Yêu cầu vai trò: ${allowedRoles.join(' hoặc ')}` 
      });
    }
    next();
  };
};

// 4. API ROUTES

app.get('/', (req, res) => {
  res.send('🚀 BIM Enterprise PPM API Server is running live!');
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.password !== password) {
      return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không chính xác!' });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role, fullName: user.fullName },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: { _id: user._id, fullName: user.fullName, email: user.email, role: user.role, department: user.department }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (user.password !== oldPassword) {
      return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không chính xác!' });
    }
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/users', authenticateToken, async (req, res) => {
  const users = await User.find({}, '-password');
  res.json(users);
});

app.post('/api/users', authenticateToken, requireRole(['Admin']), async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.get('/api/projects', authenticateToken, async (req, res) => {
  let query = {};
  if (req.user.role === 'Manager') query.managerEmail = req.user.email;
  const projects = await Project.find(query).sort({ createdAt: -1 });
  res.json(projects);
});

app.post('/api/projects', authenticateToken, requireRole(['Admin']), async (req, res) => {
  try {
    const { name, code, managerEmail } = req.body;
    if (!name || !code || !managerEmail) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ Tên, Mã dự án và Người quản lý!' });
    }
    const existingProject = await Project.findOne({ code });
    if (existingProject) {
      return res.status(400).json({ success: false, message: `Mã dự án "${code}" đã tồn tại!` });
    }
    const project = await Project.create({ name, code, managerEmail });
    res.json({ success: true, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/tasks', authenticateToken, async (req, res) => {
  const { projectId } = req.query;
  let query = {};
  if (projectId) query.projectId = projectId;
  if (req.user.role === 'Member') query.assigneeEmail = req.user.email;
  const tasks = await Task.find(query).sort({ orderIndex: 1, createdAt: 1 });
  res.json(tasks);
});

app.post('/api/tasks', authenticateToken, requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const { projectId, title, assigneeEmail } = req.body;
    const taskCount = await Task.countDocuments({ projectId });
    const task = await Task.create({
      projectId,
      title: title || 'Task mới',
      assigneeEmail,
      orderIndex: taskCount + 1
    });
    res.json({ success: true, task });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/tasks/batch', authenticateToken, requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const { projectId, count, assigneeEmail, insertAfterTaskId } = req.body;
    const numRows = Math.max(1, parseInt(count) || 1);
    let baseOrder = await Task.countDocuments({ projectId });
    let indent = 0;

    if (insertAfterTaskId) {
      const refTask = await Task.findById(insertAfterTaskId);
      if (refTask) {
        baseOrder = refTask.orderIndex;
        indent = refTask.indentLevel;
        await Task.updateMany(
          { projectId, orderIndex: { $gt: baseOrder } },
          { $inc: { orderIndex: numRows } }
        );
      }
    }

    const newTasks = [];
    for (let i = 1; i <= numRows; i++) {
      newTasks.push({
        projectId,
        title: `Công việc mới ${i}`,
        assigneeEmail: assigneeEmail || req.user.email,
        orderIndex: baseOrder + i,
        indentLevel: indent
      });
    }

    const createdTasks = await Task.insertMany(newTasks);
    res.json({ success: true, count: createdTasks.length, tasks: createdTasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/tasks/:id', authenticateToken, requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const taskId = req.params.id;
    const updateData = req.body;
    updateData.updatedAt = new Date();
    const updatedTask = await Task.findByIdAndUpdate(taskId, updateData, { new: true });
    res.json({ success: true, task: updatedTask });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.put('/api/tasks/:id/move', authenticateToken, requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const taskId = req.params.id;
    const { direction } = req.body;
    const currentTask = await Task.findById(taskId);
    if (!currentTask) return res.status(404).json({ message: 'Task không tồn tại' });

    const sortOrder = direction === 'UP' ? -1 : 1;
    const neighborTask = await Task.findOne({
      projectId: currentTask.projectId,
      orderIndex: { [direction === 'UP' ? '$lt' : '$gt']: currentTask.orderIndex }
    }).sort({ orderIndex: sortOrder });

    if (neighborTask) {
      const tempIndex = currentTask.orderIndex;
      currentTask.orderIndex = neighborTask.orderIndex;
      neighborTask.orderIndex = tempIndex;
      await currentTask.save();
      await neighborTask.save();
    }
    res.json({ success: true, task: currentTask });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/tasks/:id', authenticateToken, requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const taskId = req.params.id;
    await Task.findByIdAndDelete(taskId);
    await ReportData.deleteMany({ taskId });
    res.json({ success: true, message: 'Đã xóa công việc thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// REPORT & DUYỆT CẤP L1 / L2 (XỬ LÝ CHÍNH XÁC Ô WORK -> APPROVAL)

app.post('/api/report/submit', authenticateToken, async (req, res) => {
  try {
    const { taskId, note, work, actual, assess } = req.body;
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task không tồn tại' });

    if (req.user.role === 'Member' && task.assigneeEmail !== req.user.email) {
      return res.status(403).json({ success: false, message: 'Bạn không thể báo cáo task của người khác!' });
    }

    task.status = 'Submitted';
    task.updatedAt = new Date();
    await task.save();

    const planVal = task.planQty || 100;
    const workVal = (work !== undefined && work !== null && work !== '') ? Number(work) : planVal;
    const actualVal = (actual !== undefined && actual !== null && actual !== '') ? Number(actual) : workVal;
    const assessVal = (assess !== undefined && assess !== null && assess !== '') ? Number(assess) : 3;

    const reportLog = await ReportData.create({
      taskId,
      projectId: task.projectId,
      submittedByEmail: req.user.email,
      status: 'Submitted',
      note: note || '',
      work: workVal,
      actual: actualVal,
      assess: assessVal,
      remain: Math.max(0, planVal - workVal)
    });

    res.json({ success: true, task, reportLog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/report-data', authenticateToken, async (req, res) => {
  const { projectId } = req.query;
  let query = {};
  if (projectId) query.projectId = projectId;
  if (req.user.role === 'Member') query.submittedByEmail = req.user.email;

  const reports = await ReportData.find(query).populate('taskId').sort({ createdAt: -1 });
  res.json(reports);
});

// DUYỆT L1 (MANAGER): CẬP NHẬT WORK VÀ GÁN VÀO TASK.APPROVEDQTY
app.put('/api/report-data/:id/approve-l1', authenticateToken, requireRole(['Manager', 'Admin']), async (req, res) => {
  try {
    const { action, work, actual, assess, note } = req.body;
    const reportLog = await ReportData.findById(req.params.id);
    if (!reportLog) return res.status(404).json({ message: 'Không tìm thấy phiếu báo cáo' });

    const task = await Task.findById(reportLog.taskId);

    if (action === 'APPROVE') {
      task.status = 'L1 Approved';
      reportLog.status = 'L1 Approved';

      let finalWork = reportLog.work;
      if (work !== undefined && work !== null && work !== '') {
        finalWork = Number(work);
      }

      reportLog.work = finalWork;
      task.approvedQty = finalWork; // Cập nhật Approval ở cấp L1

      if (actual !== undefined && actual !== null && actual !== '') reportLog.actual = Number(actual);
      if (assess !== undefined && assess !== null && assess !== '') reportLog.assess = Number(assess);
      if (note !== undefined && note !== null) reportLog.note = note;

      const planVal = task.planQty || 100;
      reportLog.remain = Math.max(0, planVal - finalWork);
    } else {
      task.status = 'Rejected';
      reportLog.status = 'Rejected';
    }

    reportLog.reviewedByL1Email = req.user.email;
    await task.save();
    await reportLog.save();

    res.json({ success: true, task, reportLog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DUYỆT L2 (ADMIN): CẬP NHẬT CHÍNH THỨC CON SỐ WORK VÀO TASK.APPROVEDQTY (BỎ HẲN PLANQTY CỨNG)
app.put('/api/report-data/:id/approve-l2', authenticateToken, requireRole(['Admin']), async (req, res) => {
  try {
    const { action, work, actual, assess, note } = req.body;
    const reportLog = await ReportData.findById(req.params.id);
    if (!reportLog) return res.status(404).json({ message: 'Không tìm thấy phiếu báo cáo' });

    const task = await Task.findById(reportLog.taskId);

    if (action === 'APPROVE') {
      task.status = 'Completed';
      reportLog.status = 'Completed';

      let finalWork = reportLog.work;
      if (work !== undefined && work !== null && work !== '') {
        finalWork = Number(work);
      }

      reportLog.work = finalWork;
      task.approvedQty = finalWork; // Ghi đè chính thức Approval = con số Work thực duyệt!

      if (actual !== undefined && actual !== null && actual !== '') reportLog.actual = Number(actual);
      if (assess !== undefined && assess !== null && assess !== '') reportLog.assess = Number(assess);
      if (note !== undefined && note !== null) reportLog.note = note;

      const planVal = task.planQty || 100;
      reportLog.remain = Math.max(0, planVal - finalWork);
    } else {
      task.status = 'Rejected';
      reportLog.status = 'Rejected';
    }

    reportLog.reviewedByL2Email = req.user.email;
    await task.save();
    await reportLog.save();

    res.json({ success: true, task, reportLog });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/summary/:projectId', authenticateToken, async (req, res) => {
  const { projectId } = req.params;
  const tasks = await Task.find({ projectId });
  const project = await Project.findById(projectId);

  const statusSummary = {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'Completed').length,
    l1Approved: tasks.filter(t => t.status === 'L1 Approved').length,
    submitted: tasks.filter(t => t.status === 'Submitted').length,
    toDo: tasks.filter(t => t.status === 'To Do' || t.status === 'In Progress').length
  };

  res.json({ project, statusSummary, tasks });
});
// ==========================================
// API NÂNG CẤP DÙNG CHO REPORTDATA & SUMMARY
// ==========================================

// 1. API LẤY DỮ LIỆU REPORT DATA THEO BỘ LỌC THỜI GIAN / DỰ ÁN / USER
app.get('/api/report-data/filter', authenticateToken, async (req, res) => {
  try {
    const { projectId, userEmail, startWeek, endWeek } = req.query;
    let query = {};

    if (projectId && projectId !== 'ALL') {
      query.projectId = projectId;
    }
    if (userEmail && userEmail !== 'ALL') {
      query.submittedByEmail = userEmail;
    }

    if (req.user.role === 'Member') {
      query.submittedByEmail = req.user.email;
    }

    const reports = await ReportData.find(query)
      .populate('taskId')
      .populate('projectId')
      .sort({ createdAt: -1 });

    res.json(reports);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. API LẤY DỮ LIỆU TỔNG HỢP PIVOT SUMMARY THEO TUẦN
app.get('/api/summary-matrix', authenticateToken, async (req, res) => {
  try {
    const { groupBy = 'Project' } = req.query;
    let tasksQuery = {};

    if (req.user.role === 'Manager') {
      const myProjects = await Project.find({ managerEmail: req.user.email }).select('_id');
      tasksQuery.projectId = { $in: myProjects.map(p => p._id) };
    } else if (req.user.role === 'Member') {
      tasksQuery.assigneeEmail = req.user.email;
    }

    const tasks = await Task.find(tasksQuery).populate('projectId');
    const reports = await ReportData.find({}).populate('taskId');

    // Mẫu tổng hợp Ma trận theo Tuần
    const matrix = {};
    const weekKeys = ['W35', 'W36', 'W37', 'W38', 'W39', 'W40', 'W41'];

    tasks.forEach(t => {
      const projName = t.projectId ? t.projectId.name : 'Chưa phân loại';
      const key = groupBy === 'User' ? t.assigneeEmail : projName;
      const agreementType = (t.title.toLowerCase().includes('shop')) ? 'Shop' : 'BIM';

      if (!matrix[key]) {
        matrix[key] = {
          rowName: key,
          agreement: agreementType,
          totalPlan: 0,
          totalApproval: 0,
          weeks: {}
        };
        weekKeys.forEach(w => {
          matrix[key].weeks[w] = { plan: 0, approval: 0 };
        });
      }

      const taskPlan = t.planQty || 100;
      const taskApproval = t.approvedQty || 0;

      matrix[key].totalPlan += taskPlan;
      matrix[key].totalApproval += taskApproval;

      // Giả định phân bổ vào tuần W39 - W41 cho mẫu dữ liệu
      const sampleWeek = 'W39';
      matrix[key].weeks[sampleWeek].plan += taskPlan;
      matrix[key].weeks[sampleWeek].approval += taskApproval;
    });

    res.json({
      weekKeys,
      matrixData: Object.values(matrix)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// =======================================================
// HÀM TÍNH TUẦN THỜI GIAN THỰC ĐỊNH DẠNG T41:2026 (ISO-8601)
// =======================================================
function getWeekString(d = new Date()) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `T${weekNum}:${date.getFullYear()}`;
}

// =======================================================
// 1. API GỬI BÁO CÁO TIẾN ĐỘ (TỰ ĐỘNG KHÓA CỨNG TUẦN THỜI GIAN THỰC)
// =======================================================
app.post('/api/report/submit', authenticateToken, async (req, res) => {
  try {
    const { taskId, note, work, actual, assess } = req.body;
    
    // Tự động chốt mã tuần thời gian thực (VD: T41:2026)
    const currentWeekStr = getWeekString(new Date());

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: 'Task không tồn tại' });

    const newReport = new ReportData({
      taskId,
      projectId: task.projectId,
      submittedByEmail: req.user.email,
      note,
      work: Number(work),
      actual: Number(actual),
      assess: Number(assess),
      week: currentWeekStr, // Lưu cố định giá trị tuần vào Database
      status: 'Submitted'
    });

    await newReport.save();
    task.status = 'Submitted';
    await task.save();

    res.json({ success: true, report: newReport });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Enterprise Server running on port ${PORT}`));
