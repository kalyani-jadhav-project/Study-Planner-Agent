"""
AI Study Planner Backend
FastAPI + In-Memory Storage + Google Gemini API
A complete, beginner-friendly study planning engine for college students.
"""

import os
import json
import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(Path(__file__).parent / ".env")
load_dotenv()

# Google Gemini client setup
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

gemini_client = None
if GEMINI_API_KEY:
    try:
        from google import genai
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        print(">> Google Gemini API client initialized successfully.")
    except Exception as e:
        print(f">> Warning: Could not initialize Gemini client: {e}")
        gemini_client = None
else:
    print(">> Notice: GEMINI_API_KEY not found in environment. Heuristic planner will be used.")

# ---------------------------------------------------------
# In-Memory Storage
# ---------------------------------------------------------

_subjects: dict = {}   # {id: {id, name, difficulty, exam_date, topics, created_at}}
_tasks: dict = {}      # {id: {id, subject_id, subject_name, topic, task_date, allocated_hours, priority, status, notes, created_at}}
_settings: dict = {"daily_available_hours": "4.0"}
_subject_counter: list = [0]   # mutable counter for auto-increment IDs
_task_counter: list = [0]

def _next_subject_id() -> int:
    _subject_counter[0] += 1
    return _subject_counter[0]

def _next_task_id() -> int:
    _task_counter[0] += 1
    return _task_counter[0]

app = FastAPI(
    title="AI Study Planner API",
    description="Intelligent college study timetable planner powered by FastAPI and Google Gemini",
    version="1.0.0",
)

# Enable CORS for Frontend React app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Pydantic Schemas for Validation
# ---------------------------------------------------------

class SubjectCreate(BaseModel):
    name: str = Field(..., example="Operating Systems")
    difficulty: str = Field(..., example="Hard")  # Easy, Medium, Hard
    exam_date: str = Field(..., example="2026-10-25")  # YYYY-MM-DD
    topics: List[str] = Field(..., example=["Processes & Threads", "CPU Scheduling", "Virtual Memory"])
    daily_available_hours: Optional[float] = Field(4.0, ge=0.5, le=16.0)

class TaskStatusUpdate(BaseModel):
    status: str = Field(..., example="completed")  # 'completed', 'pending', 'missed'

class PlanGenerationRequest(BaseModel):
    daily_available_hours: Optional[float] = Field(None, ge=0.5, le=16.0)
    days_to_plan: Optional[int] = Field(7, ge=1, le=30)

class SettingsUpdate(BaseModel):
    daily_available_hours: float = Field(..., ge=0.5, le=16.0)

# ---------------------------------------------------------
# Helper Functions: Settings
# ---------------------------------------------------------

def get_setting(key: str, default: str = "") -> str:
    return _settings.get(key, default)

def set_setting(key: str, value: str):
    _settings[key] = value

# ---------------------------------------------------------
# Study Plan Generation Logic (Gemini AI + Rule-based Validator)
# ---------------------------------------------------------

def generate_plan_with_gemini(subjects_data: List[dict], daily_limit: float, days_to_plan: int) -> Optional[List[dict]]:
    """
    Calls Google Gemini API to design an optimized study plan in strict JSON.
    """
    if not gemini_client:
        return None

    today_str = datetime.date.today().isoformat()
    
    prompt = f"""
You are an expert academic study strategist and college tutor.
Today is {today_str}.
Create a high-impact, realistic study schedule for a college student for the next {days_to_plan} days.

Student's Subjects and Exams:
{json.dumps(subjects_data, indent=2)}

Strict Rules:
1. The student can study AT MOST {daily_limit} hours each day in total across all subjects.
2. Higher difficulty subjects ('Hard') and subjects with sooner exam dates must receive more priority and earlier review blocks.
3. Every task must be scheduled on or before the subject's exam date.
4. Each session should be between 0.5 and 2.5 hours.
5. Return ONLY a valid JSON array of objects. Do not wrap in markdown quotes if possible, or use standard markdown ```json.

Each JSON object must have these exact keys:
- "date": string in "YYYY-MM-DD" format (starting from {today_str})
- "subject_name": string matching one of the subjects
- "topic": string topic being studied
- "allocated_hours": number (float between 0.5 and 2.5)
- "priority": string ("High", "Medium", or "Low")
- "notes": string concise actionable study tip (e.g. "Practice round-robin algorithm diagrams")
"""
    try:
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        text = response.text.strip()
        
        # Clean potential markdown wrapping
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        tasks = json.loads(text)
        if isinstance(tasks, list):
            return tasks
    except Exception as e:
        print(f">> Gemini plan generation encountered error: {e}")
        # Try fallback model if gemini-2.5-flash failed
        try:
            response = gemini_client.models.generate_content(
                model="gemini-1.5-flash",
                contents=prompt,
            )
            text = response.text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            tasks = json.loads(text.strip())
            if isinstance(tasks, list):
                return tasks
        except Exception as e2:
            print(f">> Fallback model also encountered error: {e2}")
            
    return None

def generate_plan_heuristic(subjects_data: List[dict], daily_limit: float, days_to_plan: int) -> List[dict]:
    """
    Intelligent algorithmic planner used as fallback or baseline.
    Prioritizes upcoming exams and Hard/Medium topics within daily hour constraints.
    """
    today = datetime.date.today()
    all_topics = []

    # Difficulty weighting
    diff_hours = {"Hard": 2.0, "Medium": 1.5, "Easy": 1.0}
    diff_priority = {"Hard": "High", "Medium": "Medium", "Easy": "Low"}

    # Flatten topics with metadata
    for sub in subjects_data:
        try:
            exam_dt = datetime.datetime.strptime(sub["exam_date"], "%Y-%m-%d").date()
        except Exception:
            exam_dt = today + datetime.timedelta(days=14)
        
        days_until_exam = max(1, (exam_dt - today).days)
        sub_difficulty = sub.get("difficulty", "Medium")
        base_h = diff_hours.get(sub_difficulty, 1.5)
        prio = diff_priority.get(sub_difficulty, "Medium")
        
        # If exam is within 3 days, bump priority to High
        if days_until_exam <= 3:
            prio = "High"

        for topic in sub.get("topics", []):
            all_topics.append({
                "subject_name": sub["name"],
                "subject_id": sub.get("id"),
                "topic": topic,
                "exam_date": sub["exam_date"],
                "days_until_exam": days_until_exam,
                "base_hours": base_h,
                "priority": prio,
                "difficulty": sub_difficulty
            })

    # Sort topics: earliest exam first, then hardest difficulty
    def sort_key(t):
        diff_score = 0 if t["difficulty"] == "Hard" else (1 if t["difficulty"] == "Medium" else 2)
        return (t["days_until_exam"], diff_score)

    all_topics.sort(key=sort_key)

    # Distribute topics across available days
    tasks = []
    topic_index = 0
    total_topics = len(all_topics)

    for day_offset in range(days_to_plan):
        current_date = today + datetime.timedelta(days=day_offset)
        current_date_str = current_date.isoformat()
        day_hours_spent = 0.0

        while topic_index < total_topics and (day_hours_spent + 1.0) <= daily_limit:
            topic_item = all_topics[topic_index]
            
            # Check if current_date is past exam date
            try:
                item_exam_date = datetime.datetime.strptime(topic_item["exam_date"], "%Y-%m-%d").date()
                if current_date > item_exam_date:
                    topic_index += 1
                    continue
            except Exception:
                pass

            alloc_h = min(topic_item["base_hours"], daily_limit - day_hours_spent)
            if alloc_h < 0.5:
                break

            tasks.append({
                "date": current_date_str,
                "subject_name": topic_item["subject_name"],
                "topic": topic_item["topic"],
                "allocated_hours": round(alloc_h, 1),
                "priority": topic_item["priority"],
                "notes": f"Focus on core concepts and solve 2 practice problems. ({topic_item['difficulty']} focus)"
            })

            day_hours_spent += alloc_h
            topic_index += 1

        if topic_index >= total_topics:
            break

    return tasks

def validate_and_enforce_limits(tasks: List[dict], daily_limit: float, subjects_data: List[dict]) -> List[dict]:
    """
    CRITICAL PYTHON VALIDATOR:
    1. Enforces that total allocated hours on any given date NEVER exceeds daily_limit.
    2. Ensures dates do not exceed subject exam dates.
    3. Normalizes hour values and fills missing fields.
    """
    subject_exam_map = {s["name"].lower(): s["exam_date"] for s in subjects_data}
    valid_tasks = []
    daily_allocated = {}

    for t in tasks:
        task_date = t.get("date")
        if not task_date:
            continue
        
        subject_name = t.get("subject_name", "General Studies").strip()
        topic = t.get("topic", "Key Topics Review").strip()
        
        # Verify exam date
        exam_date_str = subject_exam_map.get(subject_name.lower())
        if exam_date_str:
            try:
                task_dt = datetime.datetime.strptime(task_date, "%Y-%m-%d").date()
                exam_dt = datetime.datetime.strptime(exam_date_str, "%Y-%m-%d").date()
                if task_dt > exam_dt:
                    continue
            except Exception:
                pass

        try:
            allocated = float(t.get("allocated_hours", 1.0))
        except (ValueError, TypeError):
            allocated = 1.0

        allocated = max(0.5, round(allocated, 1))

        # Check daily limit budget
        current_day_total = daily_allocated.get(task_date, 0.0)
        remaining_budget = daily_limit - current_day_total

        if remaining_budget < 0.5:
            continue

        actual_allocated = min(allocated, remaining_budget)
        daily_allocated[task_date] = current_day_total + actual_allocated

        priority = t.get("priority", "Medium")
        if priority not in ["High", "Medium", "Low"]:
            priority = "Medium"

        notes = t.get("notes") or f"Complete active recall and summarize {topic}"

        valid_tasks.append({
            "task_date": task_date,
            "subject_name": subject_name,
            "topic": topic,
            "allocated_hours": round(actual_allocated, 1),
            "priority": priority,
            "notes": notes,
            "status": "pending"
        })

    return valid_tasks

# ---------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------

@app.get("/api/health")
def health_check():
    """Health check and Gemini AI configuration status."""
    return {
        "status": "ok",
        "gemini_configured": bool(gemini_client),
        "database": "In-memory (no persistence)",
        "timestamp": datetime.datetime.now().isoformat()
    }

@app.get("/api/dashboard")
def get_dashboard_data():
    """Returns summarized stats for dashboard cards, upcoming exams, and progress."""
    today = datetime.date.today()

    all_tasks = list(_tasks.values())
    total_tasks = len(all_tasks)
    completed_tasks = sum(1 for t in all_tasks if t["status"] == "completed")
    missed_tasks = sum(1 for t in all_tasks if t["status"] == "missed")
    pending_tasks = sum(1 for t in all_tasks if t["status"] == "pending")
    total_hours = round(sum(t["allocated_hours"] for t in all_tasks), 1)
    completed_hours = round(sum(t["allocated_hours"] for t in all_tasks if t["status"] == "completed"), 1)
    completion_rate = round((completed_tasks / total_tasks * 100), 1) if total_tasks > 0 else 0.0

    subjects_sorted = sorted(_subjects.values(), key=lambda s: s["exam_date"])

    upcoming_exams = []
    subject_progress = []

    for s in subjects_sorted:
        try:
            exam_dt = datetime.datetime.strptime(s["exam_date"], "%Y-%m-%d").date()
            days_left = (exam_dt - today).days
        except Exception:
            days_left = 99

        urgency = "urgent" if days_left <= 3 else ("approaching" if days_left <= 7 else "normal")

        sub_tasks = [t for t in all_tasks if t["subject_name"].lower() == s["name"].lower()]
        s_total = len(sub_tasks)
        s_done = sum(1 for t in sub_tasks if t["status"] == "completed")
        s_pct = round((s_done / s_total * 100), 1) if s_total > 0 else 0.0

        upcoming_exams.append({
            "id": s["id"],
            "name": s["name"],
            "difficulty": s["difficulty"],
            "exam_date": s["exam_date"],
            "days_left": days_left,
            "urgency": urgency,
            "topics_count": len(s["topics"])
        })

        subject_progress.append({
            "id": s["id"],
            "name": s["name"],
            "difficulty": s["difficulty"],
            "exam_date": s["exam_date"],
            "total_tasks": s_total,
            "completed_tasks": s_done,
            "progress_pct": s_pct
        })

    daily_hours = float(get_setting("daily_available_hours", "4.0"))

    return {
        "summary": {
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "missed_tasks": missed_tasks,
            "pending_tasks": pending_tasks,
            "completion_rate": completion_rate,
            "total_hours": total_hours,
            "completed_hours": completed_hours,
            "daily_available_hours": daily_hours
        },
        "upcoming_exams": upcoming_exams,
        "subject_progress": subject_progress,
        "gemini_configured": bool(gemini_client)
    }

@app.get("/api/subjects")
def list_subjects():
    """List all student subjects."""
    subjects_sorted = sorted(_subjects.values(), key=lambda s: s["exam_date"])
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "difficulty": s["difficulty"],
            "exam_date": s["exam_date"],
            "topics": s["topics"],
            "created_at": s["created_at"]
        }
        for s in subjects_sorted
    ]

@app.post("/api/subjects", status_code=status.HTTP_201_CREATED)
def add_subject(sub: SubjectCreate):
    """Add a new subject with topics and difficulty."""
    sub_id = _next_subject_id()
    _subjects[sub_id] = {
        "id": sub_id,
        "name": sub.name,
        "difficulty": sub.difficulty,
        "exam_date": sub.exam_date,
        "topics": sub.topics,
        "created_at": datetime.datetime.now().isoformat()
    }

    if sub.daily_available_hours:
        set_setting("daily_available_hours", str(sub.daily_available_hours))

    return {"message": "Subject added successfully", "id": sub_id}

@app.delete("/api/subjects/{subject_id}")
def delete_subject(subject_id: int):
    """Delete a subject and its associated tasks."""
    if subject_id not in _subjects:
        raise HTTPException(status_code=404, detail="Subject not found")

    sub_name = _subjects[subject_id]["name"]
    del _subjects[subject_id]

    # Remove all tasks for this subject
    task_ids_to_delete = [tid for tid, t in _tasks.items() if t["subject_name"].lower() == sub_name.lower()]
    for tid in task_ids_to_delete:
        del _tasks[tid]

    return {"message": f"Subject '{sub_name}' and related tasks deleted"}

@app.get("/api/tasks")
def list_tasks(date: Optional[str] = None, status_filter: Optional[str] = None):
    """Get all tasks, optionally filtered by date or status."""
    result = list(_tasks.values())

    if date:
        result = [t for t in result if t["task_date"] == date]
    if status_filter:
        result = [t for t in result if t["status"] == status_filter]

    result.sort(key=lambda t: (t["task_date"], {"High": 0, "Medium": 1, "Low": 2}.get(t["priority"], 1), t["id"]))
    return result

@app.patch("/api/tasks/{task_id}/status")
def update_task_status(task_id: int, payload: TaskStatusUpdate):
    """Update task status ('completed', 'pending', 'missed')."""
    valid_statuses = ["completed", "pending", "missed"]
    if payload.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Choose from: {valid_statuses}")

    if task_id not in _tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    _tasks[task_id]["status"] = payload.status
    return {"message": "Status updated successfully", "task_id": task_id, "new_status": payload.status}

@app.post("/api/generate-plan")
def generate_study_plan(req: PlanGenerationRequest):
    """
    Main AI Study Planner endpoint:
    1. Reads subjects from in-memory store.
    2. Prompts Gemini (or invokes heuristic planner).
    3. Validates that daily study limits are strictly respected.
    4. Saves tasks into in-memory store.
    """
    if not _subjects:
        raise HTTPException(
            status_code=400,
            detail="No subjects found. Please add your subjects, topics, and exam dates first."
        )

    # Resolve daily available hours
    if req.daily_available_hours:
        daily_limit = req.daily_available_hours
        set_setting("daily_available_hours", str(daily_limit))
    else:
        daily_limit = float(get_setting("daily_available_hours", "4.0"))

    days_to_plan = req.days_to_plan or 7

    subjects_data = [
        {
            "id": s["id"],
            "name": s["name"],
            "difficulty": s["difficulty"],
            "exam_date": s["exam_date"],
            "topics": s["topics"]
        }
        for s in sorted(_subjects.values(), key=lambda s: s["exam_date"])
    ]
    subject_id_map = {s["name"].lower(): s["id"] for s in subjects_data}

    # 1. Try Gemini generation
    ai_used = False
    generated_tasks = None
    if gemini_client:
        generated_tasks = generate_plan_with_gemini(subjects_data, daily_limit, days_to_plan)
        if generated_tasks:
            ai_used = True

    # 2. Fallback to heuristic planner if Gemini unavailable
    if not generated_tasks:
        generated_tasks = generate_plan_heuristic(subjects_data, daily_limit, days_to_plan)

    # 3. Python backend validation & daily limit enforcement
    validated_tasks = validate_and_enforce_limits(generated_tasks, daily_limit, subjects_data)

    if not validated_tasks:
        raise HTTPException(status_code=500, detail="Could not formulate a valid schedule within the specified limits.")

    # 4. Clear old uncompleted tasks and insert new schedule
    completed_task_ids = [tid for tid, t in _tasks.items() if t["status"] != "completed"]
    for tid in completed_task_ids:
        del _tasks[tid]

    for t in validated_tasks:
        task_id = _next_task_id()
        _tasks[task_id] = {
            "id": task_id,
            "subject_id": subject_id_map.get(t["subject_name"].lower()),
            "subject_name": t["subject_name"],
            "topic": t["topic"],
            "task_date": t["task_date"],
            "allocated_hours": t["allocated_hours"],
            "priority": t["priority"],
            "status": "pending",
            "notes": t["notes"],
            "created_at": datetime.datetime.now().isoformat()
        }

    return {
        "message": f"Successfully generated timetable with {len(validated_tasks)} study sessions.",
        "ai_powered": ai_used,
        "engine": "Google Gemini 2.5 Flash" if ai_used else "Adaptive Heuristic Planner",
        "daily_limit_enforced_hours": daily_limit,
        "total_sessions": len(validated_tasks)
    }

@app.post("/api/reschedule")
def reschedule_missed_tasks():
    """
    Adaptive Planner:
    Identifies missed study tasks and reschedules them into upcoming days
    based on priority, remaining time before exams, and daily hour limits.
    """
    missed_tasks = sorted(
        [t for t in _tasks.values() if t["status"] == "missed"],
        key=lambda t: ({"High": 0, "Medium": 1, "Low": 2}.get(t["priority"], 1), t["id"])
    )

    if not missed_tasks:
        return {"message": "No missed tasks found to reschedule.", "rescheduled_count": 0}

    daily_limit = float(get_setting("daily_available_hours", "4.0"))
    today = datetime.date.today()
    tomorrow = today + datetime.timedelta(days=1)

    # Calculate current load for upcoming days
    daily_load: dict = {}
    for t in _tasks.values():
        if t["status"] == "pending" and t["task_date"] >= tomorrow.isoformat():
            daily_load[t["task_date"]] = daily_load.get(t["task_date"], 0.0) + t["allocated_hours"]

    sub_exams = {s["name"].lower(): s["exam_date"] for s in _subjects.values()}

    rescheduled = []
    for m in missed_tasks:
        exam_date_str = sub_exams.get(m["subject_name"].lower())
        try:
            exam_dt = datetime.datetime.strptime(exam_date_str, "%Y-%m-%d").date() if exam_date_str else today + datetime.timedelta(days=30)
        except Exception:
            exam_dt = today + datetime.timedelta(days=30)

        needed_hours = m["allocated_hours"]
        placed = False

        for day_offset in range(1, 15):
            candidate_date = today + datetime.timedelta(days=day_offset)
            if candidate_date > exam_dt:
                break

            candidate_str = candidate_date.isoformat()
            current_hours = daily_load.get(candidate_str, 0.0)

            if current_hours + needed_hours <= daily_limit:
                _tasks[m["id"]]["task_date"] = candidate_str
                _tasks[m["id"]]["status"] = "pending"
                _tasks[m["id"]]["notes"] = "Rescheduled by Adaptive AI Planner. Focus priority."
                daily_load[candidate_str] = current_hours + needed_hours
                rescheduled.append({
                    "task_id": m["id"],
                    "subject": m["subject_name"],
                    "topic": m["topic"],
                    "new_date": candidate_str
                })
                placed = True
                break

        if not placed:
            candidate_str = tomorrow.isoformat()
            _tasks[m["id"]]["task_date"] = candidate_str
            _tasks[m["id"]]["status"] = "pending"
            _tasks[m["id"]]["allocated_hours"] = 1.0
            _tasks[m["id"]]["notes"] = "Rescheduled (Condensed review to fit daily limit)"
            rescheduled.append({
                "task_id": m["id"],
                "subject": m["subject_name"],
                "topic": m["topic"],
                "new_date": candidate_str
            })

    return {
        "message": f"Successfully rescheduled {len(rescheduled)} missed study sessions.",
        "rescheduled_count": len(rescheduled),
        "details": rescheduled
    }

@app.post("/api/seed-sample-data")
def seed_sample_data():
    """Populates realistic college study subjects to make testing immediate and beginner-friendly."""
    _subjects.clear()
    _tasks.clear()

    today = datetime.date.today()
    sample_subjects = [
        {
            "name": "Data Structures & Algorithms",
            "difficulty": "Hard",
            "exam_date": (today + datetime.timedelta(days=6)).isoformat(),
            "topics": ["Dynamic Programming", "Graph Traversal (BFS/DFS)", "Binary Search Trees", "Heaps & Priority Queues"]
        },
        {
            "name": "Computer Networks",
            "difficulty": "Medium",
            "exam_date": (today + datetime.timedelta(days=12)).isoformat(),
            "topics": ["TCP/IP 3-Way Handshake", "DNS & HTTP/HTTPS", "Subnetting & Routing", "Congestion Control"]
        },
        {
            "name": "Database Management Systems",
            "difficulty": "Easy",
            "exam_date": (today + datetime.timedelta(days=18)).isoformat(),
            "topics": ["SQL Joins & Grouping", "B+ Trees Indexing", "ACID Properties & Transactions"]
        }
    ]

    for s in sample_subjects:
        sub_id = _next_subject_id()
        _subjects[sub_id] = {
            "id": sub_id,
            "name": s["name"],
            "difficulty": s["difficulty"],
            "exam_date": s["exam_date"],
            "topics": s["topics"],
            "created_at": datetime.datetime.now().isoformat()
        }

    set_setting("daily_available_hours", "4.0")

    # Automatically generate timetable
    generate_study_plan(PlanGenerationRequest(daily_available_hours=4.0, days_to_plan=7))

    return {"message": "Sample college subjects and timetable created successfully!"}

@app.delete("/api/reset")
def reset_all_data():
    """Wipes all subjects and tasks for a fresh start."""
    _subjects.clear()
    _tasks.clear()
    return {"message": "All planner data has been reset."}
