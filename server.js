const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'BIM_PPM_ENTERPRISE_SECRET_KEY_2026';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bim_ppm';

// -------------------------------------------------------------------
// 1. KẾT NỐI MONGODB ATLAS & KHỞI TẠO TÀI KHOẢN MẶC ĐỊNH
// -------------------------------------------------------------------
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ Đã kết nối MongoDB Atlas thành công!');
    
    // Tự động khởi tạo Admin
    const adminExists = await User.findOne({ email: 'bimthuylv@gmail.com' });
    if (!adminExists) {
      await User.create({
        fullName: 'Thủy LV (Admin)',
        email: 'bimthuylv@gmail.com',
        password: '123456',
        role: 'Admin',
        department: 'Ban Giám Đốc'
      });
      console.log('🎉 Khởi tạo Admin: bimthuylv@gmail.com / 123456');
    }

    // Tự động khởi tạo Manager
    const managerExists = await User.findOne({ email: 'manager@bim.com' });
    if (!managerExists) {
      await User.create({
        fullName: 'Nguyễn Văn Quản Lý',
        email: 'manager@bim.com',
        password: '123456',
        role: 'Manager',
        department: 'Ban Quản Lý Dự Án'
      });
      console.log('🎉 Khởi tạo Manager mẫu: manager@bim.com / 123456');
    }

    // Tự động khởi tạo Member
    const memberExists = await User.findOne({ email: 'member@bim.com' });
    if (!memberExists) {
      await User.create({
        fullName: 'Trần Văn Kỹ Sư',
        email: 'member@bim.com',
        password: '123456',
        role: 'Member',
        department: 'Phòng Thiết Kế'
      });
      console.log('🎉 Khởi tạo Member mẫu: member@bim.com / 123456');
    }
  })
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// -------------------------------------------------------------------
// 2. SCHEMAS & MODELS (BỔ SUNG ĐẦY ĐỦ CÁC TRƯỜNG CỘT WBS GRID)
// -------------------------------------------------------------------

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
  // Các trường mới nâng cấp cho WBS Grid
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
  createdAt: { type: Date, default: Date.now }
});
const ReportData = mongoose.model('ReportData', reportDataSchema);

// -------------------------------------------------------------------
// 3. MIDDLEWARE AUTHENTICATION & RBAC
// -------------------------------------------------------------------

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Thiếu Token xác thực đăng nhập!' });
  }

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
        message: `Bị từ chối! Chức năng này yêu cầu vai trò: ${allowedRoles.join(' hoặc ')}` 
      });
    }
    next();
  };
};

// -------------------------------------------------------------------
// 4. API ROUTES
// -------------------------------------------------------------------

app.get('/', (req, res) => {
  res.send('🚀 BIM Enterprise PPM API Server is running live!');
});

// Auth & Users
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
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        department: user.department
      }
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

// Projects
app.get('/api/projects', authenticateToken, async (req, res) => {
  let query = {};
  if (req.user.role === 'Manager') {
    query.managerEmail = req.user.email;
  }
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

    const managerUser = await User.findOne({ email: managerEmail });
    if (!managerUser) {
      return res.status(400).json({ success: false, message: 'Email người quản lý không tồn tại trong hệ thống!' });
    }

    const project = await Project.create({ name, code, managerEmail });
    res.json({ success: true, project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Tasks (Bổ sung tính năng Batch Insert, Di chuyển & Edit Inline)
app.get('/api/tasks', authenticateToken, async (req, res) => {
  const { projectId } = req.query;
  let query = {};
  if (projectId) query.projectId = projectId;

  if (req.user.role === 'Member') {
    query.assigneeEmail = req.user.email;
  }

  const tasks = await Task.find(query).sort({ orderIndex: 1, createdAt: 1 });
  res.json(tasks);
});

// TẠO 1 TASK ĐƠN LẺ
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

// CHÈN NHIỀU DÒNG CÙNG LÚC (BATCH INSERT ENHANCEMENT)
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
        // Đẩy thứ tự các task phía sau lên
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

// CẬP NHẬT TRỰC TIẾP Ô DỮ LIỆU CỘT (INLINE CELL EDIT)
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

// DI CHUYỂN VỊ TRÍ TASK (MOVE UP/DOWN)
app.put('/api/tasks/:id/move', authenticateToken, requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const taskId = req.params.id;
    const { direction } = req.body; // 'UP' hoặc 'DOWN'

    const currentTask = await Task.findById(taskId);
    if (!currentTask) return res.status(404).json({ message: 'Task không tồn tại' });

    const operator = direction === 'UP' ? $lt : $gt;
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

// XÓA TASK
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

// Reporting & Duyệt
app.post('/api/report/submit', authenticateToken, async (req, res) => {
  try {
    const { taskId, note } = req.body;
    const task = await Task.findById(taskId);

    if (!task) return res.status(404).json({ message: 'Task không tồn tại' });

    if (req.user.role === 'Member' && task.assigneeEmail !== req.user.email) {
      return res.status(403).json({ success: false, message: 'Bạn không thể báo cáo task của người khác!' });
    }

    task.status = 'Submitted';
    task.updatedAt = new Date();
    await task.save();

    const reportLog = await ReportData.create({
      taskId,
      projectId: task.projectId,
      submittedByEmail: req.user.email,
      status: 'Submitted',
      note
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

  if (req.user.role === 'Member') {
    query.submittedByEmail = req.user.email;
  }

  const reports = await ReportData.find(query).populate('taskId').sort({ createdAt: -1 });
  res.json(reports);
});

app.put('/api/report-data/:id/approve-l1', authenticateToken, requireRole(['Manager', 'Admin']), async (req, res) => {
  try {
    const { action } = req.body;
    const reportLog = await ReportData.findById(req.params.id);
    if (!reportLog) return res.status(404).json({ message: 'Không tìm thấy phiếu báo cáo' });

    const task = await Task.findById(reportLog.taskId);

    if (action === 'APPROVE') {
      task.status = 'L1 Approved';
      reportLog.status = 'L1 Approved';
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

// KHI DUYỆT L2 -> TỰ ĐỘNG CẬP NHẬT CỘT APPROVAL = PLAN QTY
app.put('/api/report-data/:id/approve-l2', authenticateToken, requireRole(['Admin']), async (req, res) => {
  try {
    const { action } = req.body;
    const reportLog = await ReportData.findById(req.params.id);
    if (!reportLog) return res.status(404).json({ message: 'Không tìm thấy phiếu báo cáo' });

    const task = await Task.findById(reportLog.taskId);

    if (action === 'APPROVE') {
      task.status = 'Completed';
      task.approvedQty = task.planQty || 100; // Đồng bộ giá trị Approval = Plan
      reportLog.status = 'Completed';
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

// Summary BI
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Enterprise Server running on port ${PORT}`));
