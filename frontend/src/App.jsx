import React, { useState, useEffect } from 'react';
import './App.css';

// Base API URL: easily switchable between local development and production deployment
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'timetable' | 'subjects' | 'guide'

  // Application Data States
  const [dashboard, setDashboard] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  // Timetable Filtering
  const [taskFilter, setTaskFilter] = useState('all'); // 'all' | 'today' | 'missed' | 'pending' | 'completed'

  // New Subject Form State
  const [newSubject, setNewSubject] = useState({
    name: '',
    difficulty: 'Medium',
    exam_date: '',
    topicInput: '',
    topics: [],
    daily_available_hours: 4.0
  });

  // Settings State
  const [dailyHours, setDailyHours] = useState(4.0);

  // Show notification toast
  const showToast = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // -------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------
  const fetchData = async () => {
    try {
      setLoading(true);
      const [dashRes, subsRes, tasksRes] = await Promise.all([
        fetch(`${API_BASE}/api/dashboard`),
        fetch(`${API_BASE}/api/subjects`),
        fetch(`${API_BASE}/api/tasks`)
      ]);

      if (dashRes.ok) {
        const dashData = await dashRes.json();
        setDashboard(dashData);
        if (dashData.summary?.daily_available_hours) {
          setDailyHours(dashData.summary.daily_available_hours);
        }
      }

      if (subsRes.ok) {
        const subsData = await subsRes.json();
        setSubjects(subsData);
      }

      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        setTasks(tasksData);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      showToast('Could not connect to backend server. Make sure FastAPI is running on port 8000.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // -------------------------------------------------------------
  // User Actions
  // -------------------------------------------------------------

  // 1. Generate Timetable using AI
  const handleGeneratePlan = async () => {
    try {
      setActionLoading(true);
      const res = await fetch(`${API_BASE}/api/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          daily_available_hours: Number(dailyHours),
          days_to_plan: 7
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to generate plan');
      }

      showToast(`✨ ${data.message} (${data.engine})`);
      await fetchData();
      setActiveTab('timetable');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // 2. Adaptive Reschedule for Missed Tasks
  const handleReschedule = async () => {
    try {
      setActionLoading(true);
      const res = await fetch(`${API_BASE}/api/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Rescheduling failed');
      }

      showToast(`🔄 ${data.message}`);
      await fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // 3. Update Task Status (completed, pending, missed)
  const handleStatusChange = async (taskId, newStatus) => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }

      // Optimistic update locally
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
      // Refresh dashboard numbers
      const dashRes = await fetch(`${API_BASE}/api/dashboard`);
      if (dashRes.ok) {
        const dashData = await dashRes.json();
        setDashboard(dashData);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // 4. Add Topic Tag in Subject Form
  const handleAddTopic = () => {
    if (!newSubject.topicInput.trim()) return;
    if (newSubject.topics.includes(newSubject.topicInput.trim())) return;
    setNewSubject({
      ...newSubject,
      topics: [...newSubject.topics, newSubject.topicInput.trim()],
      topicInput: ''
    });
  };

  const handleRemoveTopic = (index) => {
    setNewSubject({
      ...newSubject,
      topics: newSubject.topics.filter((_, i) => i !== index)
    });
  };

  // 5. Submit Subject Form
  const handleCreateSubject = async (e) => {
    e.preventDefault();
    if (!newSubject.name.trim()) {
      showToast('Please provide a subject name', 'error');
      return;
    }
    if (!newSubject.exam_date) {
      showToast('Please select an exam date', 'error');
      return;
    }
    if (newSubject.topics.length === 0) {
      showToast('Please add at least one topic', 'error');
      return;
    }

    try {
      setActionLoading(true);
      const res = await fetch(`${API_BASE}/api/subjects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSubject.name,
          difficulty: newSubject.difficulty,
          exam_date: newSubject.exam_date,
          topics: newSubject.topics,
          daily_available_hours: Number(newSubject.daily_available_hours)
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to add subject');
      }

      showToast(`Subject "${newSubject.name}" added!`);
      setNewSubject({
        name: '',
        difficulty: 'Medium',
        exam_date: '',
        topicInput: '',
        topics: [],
        daily_available_hours: 4.0
      });
      await fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // 6. Delete Subject
  const handleDeleteSubject = async (id) => {
    if (!window.confirm('Delete this subject and all its scheduled sessions?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/subjects/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete subject');
      showToast('Subject deleted');
      await fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // 7. Seed Sample Data
  const handleSeedData = async () => {
    try {
      setActionLoading(true);
      const res = await fetch(`${API_BASE}/api/seed-sample-data`, {
        method: 'POST'
      });
      const data = await res.json();
      showToast(data.message);
      await fetchData();
      setActiveTab('dashboard');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // 8. Reset All
  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to reset all subjects and timetables?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/reset`, { method: 'DELETE' });
      const data = await res.json();
      showToast(data.message);
      await fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Helper date calculations
  const todayStr = new Date().toISOString().split('T')[0];

  // Group tasks by date for the timetable
  const filteredTasks = tasks.filter(t => {
    if (taskFilter === 'today') return t.task_date === todayStr;
    if (taskFilter === 'missed') return t.status === 'missed';
    if (taskFilter === 'pending') return t.status === 'pending';
    if (taskFilter === 'completed') return t.status === 'completed';
    return true;
  });

  const tasksByDate = filteredTasks.reduce((acc, t) => {
    acc[t.task_date] = acc[t.task_date] || [];
    acc[t.task_date].push(t);
    return acc;
  }, {});

  const datesList = Object.keys(tasksByDate).sort();

  return (
    <div className="app-container">
      {/* Toast Notification */}
      {notification && (
        <div className={`toast toast-${notification.type}`}>
          <span>{notification.message}</span>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">🎓</div>
          <div className="brand-text">
            <h2>StudyGenie</h2>
            <p>AI College Planner</p>
          </div>
        </div>

        <nav className="nav-menu">
          <button
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span className="icon">📊</span>
            <span>Dashboard</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'timetable' ? 'active' : ''}`}
            onClick={() => setActiveTab('timetable')}
          >
            <span className="icon">📅</span>
            <span>Timetable</span>
            {dashboard?.summary?.pending_tasks > 0 && (
              <span className="badge-count">{dashboard.summary.pending_tasks}</span>
            )}
          </button>

          <button
            className={`nav-item ${activeTab === 'subjects' ? 'active' : ''}`}
            onClick={() => setActiveTab('subjects')}
          >
            <span className="icon">📚</span>
            <span>Subjects & Topics</span>
            <span className="badge-count-subtle">{subjects.length}</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'guide' ? 'active' : ''}`}
            onClick={() => setActiveTab('guide')}
          >
            <span className="icon">⚡</span>
            <span>AI Guide & Help</span>
          </button>
        </nav>

        {/* AI & Limit Information Box */}
        <div className="sidebar-info-card">
          <div className="ai-status-row">
            <span className={`status-dot ${dashboard?.gemini_configured ? 'dot-active' : 'dot-fallback'}`}></span>
            <span className="ai-status-label">
              {dashboard?.gemini_configured ? 'Gemini 2.5 Flash' : 'Smart Heuristic Engine'}
            </span>
          </div>
          <div className="daily-limit-info">
            <span className="info-label">Daily Limit:</span>
            <span className="info-value">{dailyHours} hrs / day</span>
          </div>
        </div>

        {/* Quick Demo Loader */}
        <div className="sidebar-footer">
          <button className="btn-demo" onClick={handleSeedData} disabled={actionLoading}>
            ⚡ Load Sample College Data
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Top Header */}
        <header className="top-header">
          <div className="header-titles">
            <h1>
              {activeTab === 'dashboard' && 'Academic Dashboard'}
              {activeTab === 'timetable' && 'Personalized Study Timetable'}
              {activeTab === 'subjects' && 'Course Curriculum & Exam Setup'}
              {activeTab === 'guide' && 'System Architecture & Study Strategy'}
            </h1>
            <p className="subtitle">
              {activeTab === 'dashboard' && 'Track exam countdowns, study pace, and curriculum milestones.'}
              {activeTab === 'timetable' && 'Daily structured study sessions tailored to difficulty and deadlines.'}
              {activeTab === 'subjects' && 'Manage your college subjects, difficulty levels, and syllabus topics.'}
              {activeTab === 'guide' && 'How the AI planner, Python limit enforcer, and adaptive rescheduling work.'}
            </p>
          </div>

          <div className="header-actions">
            <button
              className="btn-primary"
              onClick={handleGeneratePlan}
              disabled={actionLoading || subjects.length === 0}
              title={subjects.length === 0 ? 'Add subjects first' : 'Generate timetable'}
            >
              {actionLoading ? 'Thinking...' : '✨ Generate AI Plan'}
            </button>

            {dashboard?.summary?.missed_tasks > 0 && (
              <button
                className="btn-warning"
                onClick={handleReschedule}
                disabled={actionLoading}
              >
                🔄 Reschedule ({dashboard.summary.missed_tasks} Missed)
              </button>
            )}

            <button className="btn-secondary" onClick={handleReset} title="Reset all data">
              Reset
            </button>
          </div>
        </header>

        {/* Content Views */}
        {loading ? (
          <div className="loader-container">
            <div className="spinner"></div>
            <p>Loading your study blueprint...</p>
          </div>
        ) : (
          <div className="view-container">
            {/* 1. DASHBOARD VIEW */}
            {activeTab === 'dashboard' && (
              <div className="dashboard-view">
                {/* Missed Tasks Callout */}
                {dashboard?.summary?.missed_tasks > 0 && (
                  <div className="alert-banner">
                    <div className="alert-content">
                      <span className="alert-icon">⚠️</span>
                      <div>
                        <strong>You have {dashboard.summary.missed_tasks} missed study sessions!</strong>
                        <p>Don't stress. The Adaptive AI Planner can redistribute them across upcoming days without exceeding your {dailyHours}h daily limit.</p>
                      </div>
                    </div>
                    <button className="btn-alert-action" onClick={handleReschedule} disabled={actionLoading}>
                      Reschedule Now
                    </button>
                  </div>
                )}

                {/* Metric Summary Cards */}
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">Completion Pace</span>
                      <span className="stat-icon">🎯</span>
                    </div>
                    <div className="stat-number">{dashboard?.summary?.completion_rate || 0}%</div>
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill fill-primary"
                        style={{ width: `${dashboard?.summary?.completion_rate || 0}%` }}
                      ></div>
                    </div>
                    <span className="stat-subtext">
                      {dashboard?.summary?.completed_tasks || 0} of {dashboard?.summary?.total_tasks || 0} tasks done
                    </span>
                  </div>

                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">Study Hours</span>
                      <span className="stat-icon">⏱️</span>
                    </div>
                    <div className="stat-number">
                      {dashboard?.summary?.completed_hours || 0} <span className="stat-unit">/ {dashboard?.summary?.total_hours || 0} hrs</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill fill-cyan"
                        style={{
                          width: `${dashboard?.summary?.total_hours ? (dashboard.summary.completed_hours / dashboard.summary.total_hours) * 100 : 0}%`
                        }}
                      ></div>
                    </div>
                    <span className="stat-subtext">Capped at {dailyHours} hrs daily</span>
                  </div>

                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">Active Tasks</span>
                      <span className="stat-icon">📝</span>
                    </div>
                    <div className="stat-number">{dashboard?.summary?.pending_tasks || 0}</div>
                    <div className="stat-tags">
                      <span className="tag tag-pending">{dashboard?.summary?.pending_tasks || 0} Pending</span>
                      <span className="tag tag-missed">{dashboard?.summary?.missed_tasks || 0} Missed</span>
                    </div>
                  </div>

                  <div className="stat-card">
                    <div className="stat-header">
                      <span className="stat-label">Next Target Exam</span>
                      <span className="stat-icon">🏆</span>
                    </div>
                    {dashboard?.upcoming_exams?.length > 0 ? (
                      <>
                        <div className="stat-number">
                          {dashboard.upcoming_exams[0].days_left >= 0
                            ? `${dashboard.upcoming_exams[0].days_left} Days`
                            : 'Passed'}
                        </div>
                        <span className="stat-subtext stat-highlight">
                          {dashboard.upcoming_exams[0].name}
                        </span>
                      </>
                    ) : (
                      <div className="stat-subtext">No exams scheduled yet</div>
                    )}
                  </div>
                </div>

                {/* Two-Column Layout: Upcoming Exams & Subject Progress */}
                <div className="dashboard-columns">
                  {/* Upcoming Exams Countdown */}
                  <div className="card-box">
                    <div className="card-box-header">
                      <h3>Upcoming Exams Countdown</h3>
                      <button className="link-button" onClick={() => setActiveTab('subjects')}>
                        + Add Subject
                      </button>
                    </div>

                    {dashboard?.upcoming_exams?.length === 0 ? (
                      <div className="empty-state">
                        <p>No exams configured yet.</p>
                        <button className="btn-secondary btn-sm" onClick={handleSeedData}>
                          Load Sample Subjects
                        </button>
                      </div>
                    ) : (
                      <div className="exams-list">
                        {dashboard?.upcoming_exams?.map(exam => (
                          <div key={exam.id} className="exam-item">
                            <div className="exam-main">
                              <h4>{exam.name}</h4>
                              <div className="exam-meta">
                                <span className={`badge-diff badge-${exam.difficulty.toLowerCase()}`}>
                                  {exam.difficulty}
                                </span>
                                <span className="exam-date-text">📅 {exam.exam_date}</span>
                                <span className="exam-topics-count">{exam.topics_count} Topics</span>
                              </div>
                            </div>
                            <div className="exam-countdown">
                              <span className={`badge-urgency urgency-${exam.urgency}`}>
                                {exam.days_left === 0 ? 'Today!' : (exam.days_left > 0 ? `${exam.days_left}d left` : 'Completed')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Subject Mastery Progress */}
                  <div className="card-box">
                    <div className="card-box-header">
                      <h3>Subject Completion Breakdown</h3>
                      <span className="card-sub-header">By task status</span>
                    </div>

                    {dashboard?.subject_progress?.length === 0 ? (
                      <div className="empty-state">
                        <p>Generate a timetable to see subject mastery breakdown.</p>
                      </div>
                    ) : (
                      <div className="progress-list">
                        {dashboard?.subject_progress?.map(sub => (
                          <div key={sub.id} className="progress-item">
                            <div className="progress-item-header">
                              <span className="sub-title">{sub.name}</span>
                              <span className="sub-pct">{sub.progress_pct}%</span>
                            </div>
                            <div className="progress-bar-bg">
                              <div
                                className="progress-bar-fill fill-emerald"
                                style={{ width: `${sub.progress_pct}%` }}
                              ></div>
                            </div>
                            <div className="progress-item-footer">
                              <span>{sub.completed_tasks} / {sub.total_tasks} sessions completed</span>
                              <span className={`badge-diff badge-${sub.difficulty.toLowerCase()}`}>{sub.difficulty}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 2. TIMETABLE VIEW */}
            {activeTab === 'timetable' && (
              <div className="timetable-view">
                {/* Filter Controls */}
                <div className="timetable-toolbar">
                  <div className="filter-pills">
                    <button
                      className={`pill ${taskFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setTaskFilter('all')}
                    >
                      All Sessions ({tasks.length})
                    </button>
                    <button
                      className={`pill ${taskFilter === 'today' ? 'active' : ''}`}
                      onClick={() => setTaskFilter('today')}
                    >
                      Today
                    </button>
                    <button
                      className={`pill ${taskFilter === 'pending' ? 'active' : ''}`}
                      onClick={() => setTaskFilter('pending')}
                    >
                      Pending ({dashboard?.summary?.pending_tasks || 0})
                    </button>
                    <button
                      className={`pill ${taskFilter === 'missed' ? 'active' : ''}`}
                      onClick={() => setTaskFilter('missed')}
                    >
                      Missed ({dashboard?.summary?.missed_tasks || 0})
                    </button>
                    <button
                      className={`pill ${taskFilter === 'completed' ? 'active' : ''}`}
                      onClick={() => setTaskFilter('completed')}
                    >
                      Completed ({dashboard?.summary?.completed_tasks || 0})
                    </button>
                  </div>

                  <div className="toolbar-stats">
                    <span>Enforced Daily Budget: <strong>{dailyHours}h max</strong></span>
                  </div>
                </div>

                {datesList.length === 0 ? (
                  <div className="empty-state large-empty">
                    <div className="empty-icon">📅</div>
                    <h3>No scheduled study sessions match this filter</h3>
                    <p>Click "Generate AI Plan" above to create an optimized study schedule based on your subjects.</p>
                    <button className="btn-primary" onClick={handleGeneratePlan} disabled={subjects.length === 0}>
                      ✨ Generate Timetable
                    </button>
                  </div>
                ) : (
                  <div className="dates-container">
                    {datesList.map(dateKey => {
                      const dayTasks = tasksByDate[dateKey];
                      const totalDayHours = dayTasks.reduce((sum, t) => sum + t.allocated_hours, 0);
                      const isToday = dateKey === todayStr;

                      return (
                        <div key={dateKey} className={`day-group ${isToday ? 'day-today' : ''}`}>
                          <div className="day-header">
                            <div className="day-title">
                              <h3>{dateKey}</h3>
                              {isToday && <span className="today-badge">Today</span>}
                            </div>
                            <div className="day-hours-badge">
                              ⏱️ Allocated: <strong>{totalDayHours.toFixed(1)}h</strong> / {dailyHours}h
                            </div>
                          </div>

                          <div className="tasks-grid">
                            {dayTasks.map(task => (
                              <div key={task.id} className={`task-card task-card-${task.status}`}>
                                <div className="task-top">
                                  <span className="task-subject">{task.subject_name}</span>
                                  <span className={`badge-priority priority-${task.priority.toLowerCase()}`}>
                                    {task.priority} Priority
                                  </span>
                                </div>

                                <h4 className="task-topic">{task.topic}</h4>

                                <div className="task-info-row">
                                  <span className="task-duration">⏳ {task.allocated_hours} hrs</span>
                                  <span className={`task-status-pill status-${task.status}`}>
                                    {task.status.toUpperCase()}
                                  </span>
                                </div>

                                {task.notes && (
                                  <p className="task-notes">
                                    💡 <em>{task.notes}</em>
                                  </p>
                                )}

                                {/* Status Action Controls */}
                                <div className="task-actions">
                                  <button
                                    className={`btn-action btn-check ${task.status === 'completed' ? 'active' : ''}`}
                                    onClick={() => handleStatusChange(task.id, 'completed')}
                                    title="Mark Completed"
                                  >
                                    ✓ Done
                                  </button>

                                  <button
                                    className={`btn-action btn-pending ${task.status === 'pending' ? 'active' : ''}`}
                                    onClick={() => handleStatusChange(task.id, 'pending')}
                                    title="Mark Pending"
                                  >
                                    ⏳ Pending
                                  </button>

                                  <button
                                    className={`btn-action btn-missed ${task.status === 'missed' ? 'active' : ''}`}
                                    onClick={() => handleStatusChange(task.id, 'missed')}
                                    title="Mark Missed"
                                  >
                                    ⚠️ Missed
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 3. SUBJECTS & TOPICS VIEW */}
            {activeTab === 'subjects' && (
              <div className="subjects-view">
                <div className="subjects-layout">
                  {/* Left: Add Subject Form */}
                  <div className="card-box form-card">
                    <div className="card-box-header">
                      <h3>Add Subject & Exam</h3>
                    </div>

                    <form onSubmit={handleCreateSubject} className="subject-form">
                      <div className="form-group">
                        <label>Subject Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Artificial Intelligence"
                          value={newSubject.name}
                          onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })}
                          required
                        />
                      </div>

                      <div className="form-row">
                        <div className="form-group flex-1">
                          <label>Difficulty</label>
                          <select
                            value={newSubject.difficulty}
                            onChange={(e) => setNewSubject({ ...newSubject, difficulty: e.target.value })}
                          >
                            <option value="Easy">Easy (Light revision)</option>
                            <option value="Medium">Medium (Standard)</option>
                            <option value="Hard">Hard (Heavy focus)</option>
                          </select>
                        </div>

                        <div className="form-group flex-1">
                          <label>Exam Date</label>
                          <input
                            type="date"
                            min={todayStr}
                            value={newSubject.exam_date}
                            onChange={(e) => setNewSubject({ ...newSubject, exam_date: e.target.value })}
                            required
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label>
                          Daily Available Study Hours: <strong>{newSubject.daily_available_hours}h</strong>
                        </label>
                        <input
                          type="range"
                          min="1"
                          max="12"
                          step="0.5"
                          value={newSubject.daily_available_hours}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setNewSubject({ ...newSubject, daily_available_hours: val });
                            setDailyHours(val);
                          }}
                        />
                      </div>

                      {/* Topic Input with Tags */}
                      <div className="form-group">
                        <label>Syllabus Topics to Cover</label>
                        <div className="topic-input-row">
                          <input
                            type="text"
                            placeholder="Type a topic and press Add"
                            value={newSubject.topicInput}
                            onChange={(e) => setNewSubject({ ...newSubject, topicInput: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddTopic();
                              }
                            }}
                          />
                          <button type="button" className="btn-secondary" onClick={handleAddTopic}>
                            + Add Topic
                          </button>
                        </div>

                        <div className="topic-tags-container">
                          {newSubject.topics.map((t, idx) => (
                            <span key={idx} className="topic-tag">
                              {t}
                              <button type="button" onClick={() => handleRemoveTopic(idx)}>×</button>
                            </span>
                          ))}
                        </div>
                      </div>

                      <button type="submit" className="btn-primary btn-block" disabled={actionLoading}>
                        Save Subject
                      </button>
                    </form>
                  </div>

                  {/* Right: Existing Subjects List */}
                  <div className="card-box subjects-list-card">
                    <div className="card-box-header">
                      <h3>Your Registered Subjects ({subjects.length})</h3>
                      <button className="btn-secondary btn-sm" onClick={handleSeedData}>
                        Load College Samples
                      </button>
                    </div>

                    {subjects.length === 0 ? (
                      <div className="empty-state">
                        <p>No subjects added yet. Add your courses on the left or load sample college subjects.</p>
                      </div>
                    ) : (
                      <div className="subjects-grid">
                        {subjects.map(sub => (
                          <div key={sub.id} className="subject-item-card">
                            <div className="subject-item-top">
                              <h4>{sub.name}</h4>
                              <button
                                className="btn-delete"
                                onClick={() => handleDeleteSubject(sub.id)}
                                title="Delete Subject"
                              >
                                🗑️
                              </button>
                            </div>

                            <div className="subject-meta-tags">
                              <span className={`badge-diff badge-${sub.difficulty.toLowerCase()}`}>
                                {sub.difficulty}
                              </span>
                              <span className="badge-meta">📅 Exam: {sub.exam_date}</span>
                            </div>

                            <div className="subject-topics-preview">
                              <strong>Topics ({sub.topics.length}):</strong>
                              <ul>
                                {sub.topics.map((tp, i) => (
                                  <li key={i}>{tp}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 4. AI GUIDE & ARCHITECTURE VIEW */}
            {activeTab === 'guide' && (
              <div className="guide-view">
                <div className="card-box guide-card">
                  <h2>🚀 AI Study Planner Architecture & Operation</h2>
                  <p className="guide-intro">
                    This application pairs high-performance generative AI reasoning with deterministic algorithmic constraints to guarantee effective and realistic study timetables for students.
                  </p>

                  <div className="guide-steps-grid">
                    <div className="guide-step">
                      <div className="step-num">1</div>
                      <h4>Curriculum Ingestion</h4>
                      <p>Collects your subjects, topic breakdowns, difficulty scores, and hard exam deadlines into SQLite.</p>
                    </div>

                    <div className="guide-step">
                      <div className="step-num">2</div>
                      <h4>Gemini AI Strategist</h4>
                      <p>Generates structured JSON timetables prioritizing high-difficulty subjects and imminent exam dates with actionable recall tips.</p>
                    </div>

                    <div className="guide-step">
                      <div className="step-num">3</div>
                      <h4>Python Limit Validator</h4>
                      <p>Guarantees student safety: verifies that no day exceeds your <strong>{dailyHours} hours daily ceiling</strong> and clamps over-allocations.</p>
                    </div>

                    <div className="guide-step">
                      <div className="step-num">4</div>
                      <h4>Adaptive Re-balancer</h4>
                      <p>Fell behind? The adaptive agent shifts missed topics into upcoming open slots before the exam date without overwhelming any single day.</p>
                    </div>
                  </div>

                  <div className="deployment-notes">
                    <h3>🌐 Deployment & Security Checklist</h3>
                    <ul>
                      <li>
                        <strong>Render (FastAPI Backend):</strong> Set Start Command to <code>uvicorn main:app --host 0.0.0.0 --port $PORT</code>. Add <code>GEMINI_API_KEY</code> in Render Environment Variables.
                      </li>
                      <li>
                        <strong>Vercel (React Frontend):</strong> Set Root Directory to <code>frontend</code>, Build Command to <code>npm run build</code>, and configure <code>VITE_API_URL</code> to your Render URL.
                      </li>
                      <li>
                        <strong>Security:</strong> The Gemini API key remains strictly on the FastAPI server and is never exposed in browser JavaScript.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
