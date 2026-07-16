// Apply saved colour theme immediately so charts use correct CSS vars from first load
(function() {
    const t = localStorage.getItem('colorTheme');
    if (t) document.documentElement.setAttribute('data-theme', t);
})();

// ── Colour helpers ───────────────────────────────────────────
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getThemeIcon() {
    const theme = document.documentElement.getAttribute('data-theme') || '1';
    if (theme === '2') return '/static/img/icon-r.png';
    if (theme === '3') return '/static/img/icon-n.png';
    return '/static/img/icon-g.png';
}

function getThemeBell(urgency) {
    // High urgency: always red bell regardless of theme
    if (urgency === 'high') return '/static/img/Red_Bell.png';
    // Low urgency: bell matches theme
    const theme = document.documentElement.getAttribute('data-theme') || '1';
    const isLight = document.documentElement.classList.contains('light-mode');
    if (theme === '1') return isLight ? '/static/img/PurpleBell.png' : '/static/img/GreenBell.png';
    if (theme === '2') return '/static/img/OrangeBell.png';
    if (theme === '3') return '/static/img/BlueBell.png';
    return '/static/img/GreenBell.png';
}

function updateThemeIcons() {
    const icon = getThemeIcon();
    document.querySelectorAll('.goal-done-icon, .day-logo-badge').forEach(img => img.src = icon);
    // Update reminder list bell icons to match current theme
    document.querySelectorAll('.reminder-bell-icon[data-urgency]').forEach(img => {
        img.src = getThemeBell(img.dataset.urgency);
    });
}

// ── Colour theme switcher ────────────────────────────────────
function applyColorTheme(themeNum) {
    document.documentElement.setAttribute('data-theme', themeNum);
    localStorage.setItem('colorTheme', themeNum);
    document.querySelectorAll('.theme-dot').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === String(themeNum));
    });
    updateThemeIcons();
    checkReminderAlerts();
    rebuildAllCharts();
}

function rebuildAllCharts() {
    if (pillarsChartInstance)          { pillarsChartInstance.destroy();          pillarsChartInstance          = null; }
    if (weekChartInstance)             { weekChartInstance.destroy();             weekChartInstance             = null; }
    if (pillarWeekChartInstance)       { pillarWeekChartInstance.destroy();       pillarWeekChartInstance       = null; }
    if (balanceChartInstance)          { balanceChartInstance.destroy();          balanceChartInstance          = null; }
    if (weightChartInstance)           { weightChartInstance.destroy();           weightChartInstance           = null; }
    if (nutritionWeekChartInstance)    { nutritionWeekChartInstance.destroy();    nutritionWeekChartInstance    = null; }
    if (financeMonthlyChartInstance)   { financeMonthlyChartInstance.destroy();   financeMonthlyChartInstance   = null; }
    loadPillarScores();
    loadWeekChart();
    loadFinance();
    loadWeightLog();
    loadNutritionWeekChart();
}

// ── Light / dark toggle ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Restore colour theme
    const savedTheme = localStorage.getItem('colorTheme') || '1';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.querySelectorAll('.theme-dot').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === savedTheme);
    });
    document.querySelectorAll('.theme-dot').forEach(btn => {
        btn.addEventListener('click', () => applyColorTheme(btn.dataset.theme));
    });
    updateThemeIcons();

    const themeToggle = document.getElementById('themeToggle')!;
    if (localStorage.getItem('theme') === 'light') {
        document.documentElement.classList.add('light-mode');
        themeToggle.textContent = '☽';
    }
    themeToggle.addEventListener('click', () => {
        const isLight = document.documentElement.classList.toggle('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        themeToggle.textContent = isLight ? '☽' : '☀';
        checkReminderAlerts();
        rebuildAllCharts();
    });
});

// Returns today's date as YYYY-MM-DD in local time (not UTC)
function getLocalDateString() {
    const d = new Date();
    return dateToLocalString(d);
}

function dateToLocalString(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Activity presets with suggested points - now stored in database
let activities: Record<string, any[]> = {
    physical: [],
    work: [],
    health: [],
    relationships: [],
    mindset: []
};

// Built-in pillar categories (always present); custom ones are loaded from the DB
const BUILTIN_CATEGORIES = ['physical', 'work', 'health', 'relationships', 'mindset'];
let customCategories: any[] = [];

// Fetch user-created categories from the database
async function loadCategories() {
    try {
        const response = await fetch('/api/categories');
        customCategories = await response.json();
    } catch (error) {
        console.error('Error loading categories:', error);
        customCategories = [];
    }
    populateCategoryDropdowns();
}

// Inject custom category options into the "Log a Win" and "Manage Activities" dropdowns
function populateCategoryDropdowns() {
    // Remove any previously injected custom options
    document.querySelectorAll('option.custom-cat-option').forEach(o => o.remove());

    const winSelect = document.getElementById('category')!;
    const manageSelect = document.getElementById('manageCategory')!;
    const fulldayOpt = winSelect.querySelector('option[value="fullday"]');

    customCategories.forEach(name => {
        const winOpt = document.createElement('option');
        winOpt.value = name;
        winOpt.textContent = name;
        winOpt.className = 'custom-cat-option';
        winSelect.insertBefore(winOpt, fulldayOpt);

        const manageOpt = document.createElement('option');
        manageOpt.value = name;
        manageOpt.textContent = name;
        manageOpt.className = 'custom-cat-option';
        manageSelect.appendChild(manageOpt);
    });
}

// Default activities (will be added to DB if empty)
const defaultActivities = {
    physical: [
        { name: 'Gym session', points: 50 },
        { name: 'Football', points: 60 },
        { name: 'Volleyball', points: 50 },
        { name: 'Running', points: 40 },
        { name: 'Stretching', points: 20 },
        { name: 'Cycling', points: 40 },
        { name: 'Swimming', points: 60 }
    ],
    work: [
        { name: 'Studied well', points: 80 },
        { name: 'Focused work session', points: 70 },
        { name: 'Learned something new', points: 60 },
        { name: 'Read a book', points: 50 },
        { name: 'Completed a project task', points: 60 },
        { name: 'Attended a lecture', points: 40 }
    ],
    health: [
        { name: 'Good diet (no junk food)', points: 50 },
        { name: 'No Pepsi/soda', points: 30 },
        { name: 'Drank enough water', points: 20 },
        { name: 'Slept 8+ hours', points: 60 },
        { name: 'Took vitamins', points: 10 },
    ],
    relationships: [
        { name: 'Made new friends', points: 80 },
        { name: 'Went out with friends', points: 60 },
        { name: 'Had meaningful conversation', points: 50 },
        { name: 'Helped someone', points: 40 },
        { name: 'Attended social event', points: 70 }
    ],
    mindset: [
        { name: 'Cold shower', points: 30 },
        { name: 'Meditation', points: 40 },
        { name: 'Felt confident', points: 50 },
        { name: 'Felt motivated', points: 50 },
        { name: 'Felt grateful', points: 35 },
        { name: 'Felt productive', points: 45 },
        { name: 'Felt anxious', points: 10 },
        { name: 'Felt stressed', points: 10 }
    ]
};

// Load activities from database
async function loadActivitiesFromDatabase() {
    try {
        const response = await fetch('/api/activities');
        const dbActivities = await response.json();
        
        // If database is empty, populate with defaults
        if (dbActivities.length === 0) {
            await populateDefaultActivities();
            await loadActivitiesFromDatabase(); // Reload after populating
            return;
        }
        
        // Clear current activities — one bucket per built-in and custom category
        activities = {};
        BUILTIN_CATEGORIES.forEach(cat => { activities[cat] = []; });
        customCategories.forEach(cat => { activities[cat] = []; });
        
        // Organize by category
        dbActivities.forEach(activity => {
            if (activities[activity.category]) {
                activities[activity.category].push({
                    id: activity.id,
                    name: activity.name,
                    points: activity.points
                });
            }
        });
    } catch (error) {
        console.error('Error loading activities:', error);
    }
}

// Populate database with default activities
async function populateDefaultActivities() {
    for (const category in defaultActivities) {
        for (const activity of defaultActivities[category]) {
            await fetch('/api/activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category: category,
                    name: activity.name,
                    points: activity.points
                })
            });
        }
    }
}

// Activity Management
document.getElementById('manageCategory')!.addEventListener('change', (e) => {
    const category = e.target!.value;
    const manager = document.getElementById('activityManager')!;
    const deleteBtn = document.getElementById('deleteCategoryBtn')!;

    if (category) {
        manager.style.display = 'block';
        displayActivitiesForCategory(category);
        // Only custom categories can be deleted
        deleteBtn.style.display = customCategories.includes(category) ? 'inline-block' : 'none';
    } else {
        manager.style.display = 'none';
        deleteBtn.style.display = 'none';
    }
});

// Create a new custom category
document.getElementById('createCategoryForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('newCategoryName')!;
    const name = input.value.trim();
    if (!name) return;

    try {
        const response = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            alert(data.error || 'Could not create category');
            return;
        }

        input.value = '';
        await loadCategories();
        await loadActivitiesFromDatabase();

        // Select the new category so its activities can be managed right away
        const manageSelect = document.getElementById('manageCategory')!;
        manageSelect.value = name;
        manageSelect.dispatchEvent(new Event('change'));
    } catch (error) {
        console.error('Error creating category:', error);
    }
});

// Delete the selected custom category (and its preset activities)
document.getElementById('deleteCategoryBtn')!.addEventListener('click', async () => {
    const category = document.getElementById('manageCategory')!.value;
    if (!category || !customCategories.includes(category)) return;
    if (!confirm(`Delete the "${category}" category and all of its preset activities?`)) return;

    try {
        const response = await fetch(`/api/categories?name=${encodeURIComponent(category)}`, { method: 'DELETE' });
        if (response.ok) {
            await loadCategories();
            await loadActivitiesFromDatabase();
            const manageSelect = document.getElementById('manageCategory')!;
            manageSelect.value = '';
            manageSelect.dispatchEvent(new Event('change'));
        }
    } catch (error) {
        console.error('Error deleting category:', error);
    }
});

function displayActivitiesForCategory(category) {
    const activitiesList = document.getElementById('activitiesList')!;
    activitiesList.innerHTML = '';
    
    if (!activities[category] || activities[category].length === 0) {
        activitiesList.innerHTML = '<p style="color: #8b92b0;">No activities yet.</p>';
        return;
    }
    
    activities[category].forEach((activity) => {
        const activityItem = document.createElement('div');
        activityItem.className = 'activity-item';
        activityItem.id = `activity-${activity.id}`;
        
        activityItem.innerHTML = `
            <div class="activity-item-info">
                <span class="activity-item-name">${activity.name}</span>
                <span class="activity-item-points">${activity.points} pts</span>
            </div>
            <div class="activity-item-actions">
                <button class="btn-edit" onclick="editActivity(${activity.id}, '${category}')">Edit</button>
                <button class="btn-delete-activity" onclick="deleteActivity(${activity.id}, '${category}')">Delete</button>
            </div>
        `;
        
        activitiesList.appendChild(activityItem);
    });
}

// Add new activity
document.getElementById('addActivityForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const category = document.getElementById('manageCategory')!.value;
    const name = document.getElementById('newActivityName')!.value;
    const points = parseInt(document.getElementById('newActivityPoints')!.value);
    
    try {
        const response = await fetch('/api/activities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category, name, points })
        });
        
        if (response.ok) {
            await loadActivitiesFromDatabase();
            displayActivitiesForCategory(category);
            updateActivityDropdown(category);
            
            // Reset form
            document.getElementById('newActivityName')!.value = '';
            document.getElementById('newActivityPoints')!.value = '';
        }
    } catch (error) {
        console.error('Error adding activity:', error);
    }
});

async function editActivity(activityId, category) {
    const activity = activities[category].find(a => a.id === activityId);
    if (!activity) return;
    
    const newName = prompt('Edit activity name:', activity.name);
    if (newName === null) return; // User cancelled
    
    const newPoints = prompt('Edit points:', activity.points);
    if (newPoints === null) return; // User cancelled
    
    const pointsNum = parseInt(newPoints);
    if (isNaN(pointsNum) || pointsNum < 0) {
        alert('Please enter a valid number for points');
        return;
    }
    
    try {
        const response = await fetch('/api/activities', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: activityId, name: newName, points: pointsNum })
        });
        
        if (response.ok) {
            await loadActivitiesFromDatabase();
            displayActivitiesForCategory(category);
            updateActivityDropdown(category);
        }
    } catch (error) {
        console.error('Error editing activity:', error);
    }
}

async function deleteActivity(activityId, category) {
    if (!confirm('Are you sure you want to delete this activity?')) return;
    
    try {
        const response = await fetch(`/api/activities?id=${activityId}`, { method: 'DELETE' });
        
        if (response.ok) {
            await loadActivitiesFromDatabase();
            displayActivitiesForCategory(category);
            updateActivityDropdown(category);
        }
    } catch (error) {
        console.error('Error deleting activity:', error);
    }
}

function updateActivityDropdown(category) {
    const activitySelect = document.getElementById('activity')!;
    const currentCategory = document.getElementById('category')!.value;

    // Only update if we're viewing the same category
    if (currentCategory === category) {
        activitySelect.innerHTML = '<option value="">Select activity</option>';

        if (activities[category]) {
            activities[category].forEach(activity => {
                const option = document.createElement('option');
                option.value = activity.name;
                option.textContent = activity.name;
                option.dataset.points = activity.points;
                activitySelect.appendChild(option);
            });
        }
        const otherOpt = document.createElement('option');
        otherOpt.value = 'other';
        otherOpt.textContent = 'Other…';
        activitySelect.appendChild(otherOpt);
    }
}

// Tab switching
function activateTab(tabId) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const content = document.getElementById(tabId);
    if (!btn || !content) return;

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    content.classList.add('active');
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        activateTab(btn.dataset.tab!);
        localStorage.setItem('activeTab', btn.dataset.tab!);
    });
});

// Restore the last active tab after a refresh
const savedTab = localStorage.getItem('activeTab');
if (savedTab) activateTab(savedTab);

// Set current date
const dateInput = document.getElementById('currentDate')!;
dateInput.value = getLocalDateString();

// Date change listener
dateInput.addEventListener('change', () => {
    loadDailySummary();
    loadWins();
    loadDailyGoals(dateInput.value);
});

// Category change listener - populate activities
document.getElementById('category')!.addEventListener('change', (e) => {
    const category = e.target!.value;
    const activitySelect = document.getElementById('activity')!;
    const categoryOther = document.getElementById('categoryOther')!;
    const pointsInput = document.getElementById('points')!;

    // Show/hide custom category text input
    if (category === 'other') {
        categoryOther.classList.add('visible');
        categoryOther.required = true;
    } else {
        categoryOther.classList.remove('visible');
        categoryOther.required = false;
        categoryOther.value = '';
    }

    // "Full Day" auto-fills max points for every category — no activity/points needed
    if (category === 'fullday') {
        activitySelect.required = false;
        activitySelect.disabled = true;
        pointsInput.required = false;
        pointsInput.disabled = true;
        pointsInput.value = '';
    } else {
        activitySelect.disabled = false;
        activitySelect.required = true;
        pointsInput.disabled = false;
        pointsInput.required = true;
    }

    activitySelect.innerHTML = '<option value="">Select activity</option>';

    if (category === 'fullday') {
        return;
    }

    if (category && category !== 'other' && activities[category]) {
        activities[category].forEach(activity => {
            const option = document.createElement('option');
            option.value = activity.name;
            option.textContent = activity.name;
            option.dataset.points = activity.points;
            activitySelect.appendChild(option);
        });
    }
    // Always append "Other" option at the bottom
    const otherOpt = document.createElement('option');
    otherOpt.value = 'other';
    otherOpt.textContent = 'Other…';
    activitySelect.appendChild(otherOpt);
});

// Activity change listener - suggest points / show custom input
document.getElementById('activity')!.addEventListener('change', (e) => {
    const selectedOption = e.target!.options[e.target!.selectedIndex];
    const activityOther = document.getElementById('activityOther')!;

    if (e.target!.value === 'other') {
        activityOther.classList.add('visible');
        activityOther.required = true;
        document.getElementById('points')!.value = '';
    } else {
        activityOther.classList.remove('visible');
        activityOther.required = false;
        activityOther.value = '';
        const suggestedPoints = selectedOption.dataset.points;
        if (suggestedPoints) {
            document.getElementById('points')!.value = suggestedPoints;
        }
    }
});

// Win form submission
document.getElementById('winForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();

    let category = document.getElementById('category')!.value;
    let activity = document.getElementById('activity')!.value;
    const duration = document.getElementById('duration')!.value;
    const description = document.getElementById('description')!.value;
    const points = document.getElementById('points')!.value;
    const date = dateInput.value;

    // "Full Day" — max out every scoring category in one shot
    if (category === 'fullday') {
        const FULL_DAY_CATEGORIES = ['physical', 'work', 'health', 'relationships', 'mindset'];
        const MAX_POINTS_PER_CATEGORY = 200;
        try {
            await Promise.all(FULL_DAY_CATEGORIES.map(cat =>
                fetch('/api/wins', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        category: cat,
                        activity: 'Full Day',
                        duration: 0,
                        description: description || 'Full Day — max points',
                        points: MAX_POINTS_PER_CATEGORY,
                        date
                    })
                })
            ));
            document.getElementById('winForm')!.reset();
            document.getElementById('category')!.dispatchEvent(new Event('change'));
            loadDailySummary();
            loadWins();
            loadXP();
            loadXPLog();
            checkCompleteDay();
        } catch (error) {
            console.error('Error adding Full Day:', error);
        }
        return;
    }

    // Resolve "Other" values
    if (category === 'other') {
        category = document.getElementById('categoryOther')!.value.trim();
        if (!category) return;
    }
    if (activity === 'other') {
        activity = document.getElementById('activityOther')!.value.trim();
        if (!activity) return;
    }

    try {
        const response = await fetch('/api/wins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                category,
                activity,
                duration: duration || 0,
                description: description || '',
                points: parseInt(points),
                date
            })
        });
        
        if (response.ok) {
            document.getElementById('winForm')!.reset();
            loadDailySummary();
            loadWins();
            loadXP();
            loadXPLog();
            checkCompleteDay();
        }
    } catch (error) {
        console.error('Error adding win:', error);
    }
});

// Load daily summary
async function loadDailySummary() {
    const date = dateInput.value;

    try {
        const response = await fetch(`/api/daily-summary?date=${date}`);
        const summary = await response.json();

        document.getElementById('physical-points')!.textContent = summary.physical;
        document.getElementById('work-points')!.textContent = summary.work;
        document.getElementById('health-points')!.textContent = summary.health;
        document.getElementById('relationships-points')!.textContent = summary.relationships;
        document.getElementById('mindset-points')!.textContent = summary.mindset;
        document.getElementById('total-points')!.textContent = summary.total;

    } catch (error) {
        console.error('Error loading summary:', error);
    }
}

async function loadPillarScores() {
    try {
        const response = await fetch('/api/pillar-scores');
        const scores = await response.json();
        document.getElementById('score-physical')!.value      = scores.physical;
        document.getElementById('score-work')!.value          = scores.work;
        document.getElementById('score-health')!.value        = scores.health;
        document.getElementById('score-relationships')!.value = scores.relationships;
        document.getElementById('score-mindset')!.value       = scores.mindset;
        loadPillarsChart(scores);
    } catch (error) {
        console.error('Error loading pillar scores:', error);
    }
}

async function savePillarScores() {
    const scores = {
        physical:      parseFloat(document.getElementById('score-physical')!.value)      || 0,
        work:          parseFloat(document.getElementById('score-work')!.value)          || 0,
        health:        parseFloat(document.getElementById('score-health')!.value)        || 0,
        relationships: parseFloat(document.getElementById('score-relationships')!.value) || 0,
        mindset:       parseFloat(document.getElementById('score-mindset')!.value)       || 0
    };
    try {
        await fetch('/api/pillar-scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scores)
        });
        loadPillarsChart(scores);
    } catch (error) {
        console.error('Error saving pillar scores:', error);
    }
}

// Personal Pillars radar chart
let pillarsChartInstance: any = null;
const pillarsLogoImg = new Image();

function loadPillarsChart(scores) {
    pillarsLogoImg.onload = () => { if (pillarsChartInstance) pillarsChartInstance.update(); };
    pillarsLogoImg.src = getThemeIcon();
    const ctx = document.getElementById('pillarsChart')!.getContext('2d');
    const data = [
        scores.physical    || 0,
        scores.work        || 0,
        scores.health      || 0,
        scores.relationships || 0,
        scores.mindset     || 0
    ];
    const overall = data.reduce((a, b) => a + b, 0);
    document.getElementById('overallGrowth')!.textContent = `Overall Growth: ${overall.toFixed(1)} / 50`;

    const logoPlugin = {
        id: 'pillarsLogo',
        afterDraw(chart) {
            if (!pillarsLogoImg.complete || !pillarsLogoImg.naturalWidth) return;
            const { ctx: c } = chart;
            const cx = chart.scales.r.xCenter;
            const cy = chart.scales.r.yCenter;
            const size = 38;
            c.save();
            c.globalAlpha = 0.85;
            c.drawImage(pillarsLogoImg, cx - size / 2, cy - size / 2, size, size);
            c.restore();
        }
    };

    if (pillarsChartInstance) {
        pillarsChartInstance.data.datasets[0].data = data;
        pillarsChartInstance.update();
        return;
    }

    const pRgb = cssVar('--color-primary-rgb');
    const labelColor = cssVar('--color-primary');
    const gridColor  = `rgba(${pRgb}, 0.2)`;

    pillarsChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Physical', 'Work', 'Health', 'Relationships', ['Mindset', '& Discipline']],
            datasets: [{
                data,
                backgroundColor: `rgba(${pRgb}, 0.15)`,
                borderColor: `rgba(${pRgb}, 0.8)`,
                pointBackgroundColor: cssVar('--color-primary'),
                pointBorderColor: cssVar('--color-primary'),
                pointRadius: 4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            scales: {
                r: {
                    min: 0,
                    max: 10,
                    ticks: {
                        display: false,
                        stepSize: 50
                    },
                    grid: { color: gridColor },
                    angleLines: { color: gridColor },
                    pointLabels: {
                        color: labelColor,
                        font: { family: 'Inter', size: 11 }
                    }
                }
            },
            plugins: {
                legend: { display: false }
            }
        },
        plugins: [logoPlugin]
    });
}

// Load wins list
async function loadWins() {
    const date = dateInput.value;

    // Update header to reflect selected date
    const header = document.getElementById('winsListHeader')!;
    if (date === getLocalDateString()) {
        header.textContent = "Today's Wins";
    } else {
        const d = new Date(date + 'T00:00:00');
        header.textContent = `Wins for ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
    }

    try {
        const response = await fetch(`/api/wins?date=${date}`);
        const wins = await response.json();

        const winsList = document.getElementById('winsList')!;
        winsList.innerHTML = '';

        if (wins.length === 0) {
            winsList.innerHTML = '<p style="color: #999;">No wins logged yet for this day.</p>';
            return;
        }

        // Most recently added win is last in the array (insert order)
        const reversed = [...wins].reverse();

        function renderWinItem(win) {
            const el = document.createElement('div');
            el.className = 'win-item';
            el.innerHTML = `
                <div class="win-item-info">
                    <div class="win-item-category">${win.category.toUpperCase()}</div>
                    <div>${win.activity}${win.duration ? ` (${win.duration} min)` : ''}</div>
                    ${win.description ? `<div class="win-item-description">${win.description}</div>` : ''}
                </div>
                <div class="win-item-points">+${win.points}</div>
                <button class="win-item-delete" onclick="deleteWin(${win.id})">Delete</button>
            `;
            return el;
        }

        function renderCollapsed() {
            winsList.innerHTML = '';
            winsList.appendChild(renderWinItem(reversed[0]));
            if (reversed.length > 1) {
                const btn = document.createElement('button');
                btn.className = 'btn-secondary wins-toggle-btn';
                btn.textContent = `Show All (${reversed.length})`;
                btn.onclick = renderExpanded;
                winsList.appendChild(btn);
            }
        }

        function renderExpanded() {
            winsList.innerHTML = '';
            reversed.forEach(win => winsList.appendChild(renderWinItem(win)));
            const btn = document.createElement('button');
            btn.className = 'btn-secondary wins-toggle-btn';
            btn.textContent = 'Show Less';
            btn.onclick = renderCollapsed;
            winsList.appendChild(btn);
        }

        renderCollapsed();
    } catch (error) {
        console.error('Error loading wins:', error);
    }
}

// Week chart
let weekChartInstance: any = null;
let pillarWeekChartInstance: any = null;
let weekGoalsAllDone: any[] = [];
const barLogoImg = new Image();
barLogoImg.src = '/static/img/icon.png';

const barLogoPlugin = {
    id: 'barLogo',
    afterDatasetsDraw(chart) {
        if (!barLogoImg.complete || !barLogoImg.naturalWidth) return;
        const { ctx, data } = chart;
        const dataset = chart.getDatasetMeta(0);
        const size = 22;
        dataset.data.forEach((bar, i) => {
            if (data.datasets[0].data[i] >= 1000 && weekGoalsAllDone[i]) {
                ctx.save();
                ctx.globalAlpha = 0.85;
                ctx.drawImage(barLogoImg, bar.x - size / 2, bar.y - size - 4, size, size);
                ctx.restore();
            }
        });
    }
};

async function loadWeekChart() {
    try {
        const response = await fetch('/api/week-data');
        const data = await response.json();

        const labels = data.map(d => {
            const date = new Date(d.date + 'T00:00:00');
            return date.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' });
        });
        const points = data.map(d => d.points);
        weekGoalsAllDone = data.map(d => d.goals_all_done);

        const ctx = document.getElementById('weekChart')!.getContext('2d');

        if (weekChartInstance) {
            weekChartInstance.destroy();
        }

        weekChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Points',
                    data: points,
                    backgroundColor: `rgba(${cssVar('--color-primary-rgb')}, 0.6)`,
                    borderColor: `rgba(${cssVar('--color-primary-rgb')}, 1)`,
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 1000,
                        grid: { color: document.documentElement.classList.contains('light-mode') ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)' },
                        ticks: { color: document.documentElement.classList.contains('light-mode') ? '#6b7280' : '#8b92b0' }
                    },
                    x: {
                        grid: { color: document.documentElement.classList.contains('light-mode') ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)' },
                        ticks: { color: document.documentElement.classList.contains('light-mode') ? '#6b7280' : '#8b92b0' }
                    }
                }
            },
            plugins: [barLogoPlugin]
        });
        // ── Pillar breakdown line chart ──────────────────────────
        const isLight = document.documentElement.classList.contains('light-mode');
        const gridColor = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)';
        const tickColor = isLight ? '#6b7280' : '#8b92b0';

        const pillarColors = {
            physical:      '#f59e0b',
            work:          '#60a5fa',
            health:        '#34d399',
            relationships: '#f472b6',
            mindset:       '#a78bfa',
            total:         isLight ? '#6b7280' : '#e5e7eb',
        };

        const pillarLabels = {
            physical: 'Physical', work: 'Work', health: 'Health',
            relationships: 'Relationships', mindset: 'Mindset & Discipline', total: 'Total'
        };

        const pillarDatasets = Object.keys(pillarColors).map(key => ({
            label: pillarLabels[key],
            data: data.map(d => d[key] || 0),
            borderColor: pillarColors[key],
            backgroundColor: pillarColors[key] + '22',
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.35,
            fill: false,
        }));

        const pillarCtx = document.getElementById('pillarWeekChart')!.getContext('2d');
        if (pillarWeekChartInstance) pillarWeekChartInstance.destroy();
        pillarWeekChartInstance = new Chart(pillarCtx, {
            type: 'line',
            data: { labels, datasets: pillarDatasets },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: tickColor, boxWidth: 12, padding: 16 }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: gridColor },
                        ticks: { color: tickColor }
                    },
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: tickColor }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading week chart:', error);
    }
}

// Delete win function
async function deleteWin(id) {
    if (!confirm('Are you sure you want to delete this win?')) return;
    
    try {
        await fetch(`/api/wins?id=${id}`, { method: 'DELETE' });
        loadDailySummary();
        loadWins();
    } catch (error) {
        console.error('Error deleting win:', error);
    }
}

// Toggle collapsible sections
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId)!;
    const btn = section.previousElementSibling!.querySelector('.collapse-btn')!;
    
    if (section.classList.contains('collapsed')) {
        section.classList.remove('collapsed');
        btn.classList.remove('collapsed');
    } else {
        section.classList.add('collapsed');
        btn.classList.add('collapsed');
    }
}

// Task management functions
const taskPeriods = ['today', 'weekly', 'monthly'];
const goalPeriods = ['weekly', 'monthly', 'yearly', 'lifelong'];

function priorityFromXP(xp, period) {
    // Yearly and lifelong are always high regardless of XP
    if (period === 'yearly' || period === 'lifelong') return 'high';
    if (xp >= 50000) return 'high';
    if (xp >= 10000) return 'medium';
    return 'low';
}

// Setup all task forms (goal types only — Tasks tab removed)
function setupTaskForms() {
    function bindGoalForm(formId, period) {
        document.getElementById(formId)!.addEventListener('submit', async (e) => {
            e.preventDefault();
            const xpInput  = e.target!.querySelector('.task-xp-input');
            const xpReward = xpInput ? (parseInt(xpInput.value) || 0) : 0;
            const priority = priorityFromXP(xpReward, period);
            const monthInput = e.target!.querySelector('.goal-month-input');
            const targetMonth = monthInput ? monthInput.value : '';
            await addTask(e.target!.querySelector('.task-input')!.value, 'goal', period, xpReward, priority, targetMonth);
            e.target!.reset();
        });
    }
    bindGoalForm('weeklyGoalForm', 'weekly');
    bindGoalForm('monthlyGoalForm', 'monthly');
    bindGoalForm('yearlyGoalForm', 'yearly');
    bindGoalForm('lifelongGoalForm', 'lifelong');
}

async function addTask(task, taskType, period, xpReward = 0, priority = 'medium', targetMonth = '') {
    try {
        const response = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task, task_type: taskType, period, xp_reward: xpReward, priority, target_month: targetMonth })
        });
        
        if (response.ok) {
            loadAllTasks().then(() => populateConditionsGoalSelect());
        }
    } catch (error) {
        console.error('Error adding task:', error);
    }
}

async function loadAllTasks() {
    // Load all goal periods
    await loadTasksByPeriod('weekly', 'weeklyGoalsList', 'goal');
    await loadTasksByPeriod('monthly', 'monthlyGoalsList', 'goal');
    await loadTasksByPeriod('yearly', 'yearlyGoalsList', 'goal');
    await loadTasksByPeriod('lifelong', 'lifelongGoalsList', 'goal');
    await loadUpcomingMonthlyGoals();
}

async function loadUpcomingMonthlyGoals() {
    try {
        const res = await fetch('/api/tasks?type=goal&period=monthly-upcoming');
        const tasks = await res.json();
        const container = document.getElementById('upcomingMonthlyGoals')!;
        container.innerHTML = '';
        if (tasks.length === 0) return;

        const title = document.createElement('div');
        title.className = 'upcoming-goals-title';
        title.textContent = 'Upcoming';
        container.appendChild(title);

        let lastMonth = '';
        tasks.forEach(task => {
            const month = task.target_month || (task.created_at || '').slice(0, 7);
            if (month !== lastMonth) {
                lastMonth = month;
                const header = document.createElement('div');
                header.className = 'upcoming-month-header';
                header.textContent = formatPeriodMonth(month);
                container.appendChild(header);
            }

            const item = document.createElement('div');
            item.className = 'task-item upcoming-goal-item';

            const textDiv = document.createElement('div');
            textDiv.className = 'task-item-text';
            textDiv.textContent = task.task;
            item.appendChild(textDiv);

            if (task.xp_reward > 0) {
                const badge = document.createElement('span');
                badge.className = 'task-xp-badge';
                badge.textContent = `+${task.xp_reward} XP`;
                item.appendChild(badge);
            }

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'task-item-delete';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => deleteTask(task.id));
            item.appendChild(deleteBtn);

            container.appendChild(item);
        });
    } catch (err) {
        console.error('Error loading upcoming monthly goals:', err);
    }
}

async function loadTasksByPeriod(period, listId, taskType) {
    try {
        const response = await fetch(`/api/tasks?type=${taskType}&period=${period}`);
        const tasks = await response.json();

        const tasksList = document.getElementById(listId)!;
        tasksList.innerHTML = '';

        if (tasks.length === 0) {
            tasksList.innerHTML = '<p style="color: #8b92b0; text-align: center; padding: 20px;">No items yet.</p>';
            return;
        }

        tasks.forEach(task => {
            const taskItem = document.createElement('div');
            taskItem.className = 'task-item' + (task.completed === 1 ? ' completed' : '');

            // Custom tick box — more reliable than native checkbox in this context
            const tick = document.createElement('div');
            tick.className = 'goal-tick' + (task.completed === 1 ? ' goal-tick-done' : '');
            tick.onclick = () => {
                const nowDone = !tick.classList.contains('goal-tick-done');
                tick.classList.toggle('goal-tick-done', nowDone);
                taskItem.classList.toggle('completed', nowDone);
                toggleTask(task.id, nowDone);
            };

            const periodDefaults2 = { weekly: 50, monthly: 100, yearly: 200, lifelong: 500, today: 25 };
            const xpForPriority = task.xp_reward > 0 ? task.xp_reward : periodDefaults2[task.period] || 50;
            const priority = priorityFromXP(xpForPriority, task.period);
            const priBadge = document.createElement('span');
            priBadge.className = `priority-badge priority-${priority}`;
            priBadge.textContent = priority.charAt(0).toUpperCase();
            priBadge.title = priority.charAt(0).toUpperCase() + priority.slice(1) + ' priority';

            const textDiv = document.createElement('div');
            textDiv.className = 'task-item-text';
            textDiv.textContent = task.task;

            taskItem.appendChild(tick);
            taskItem.appendChild(priBadge);
            taskItem.appendChild(textDiv);

            const periodDefaults = { weekly: 50, monthly: 100, yearly: 200, lifelong: 500, today: 25 };
            const xpDisplay = task.xp_reward > 0 ? task.xp_reward : (periodDefaults[task.period] || 50);
            const badge = document.createElement('span');
            badge.className = 'task-xp-badge';
            badge.textContent = `+${xpDisplay} XP`;
            taskItem.appendChild(badge);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'task-item-delete';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => deleteTask(task.id));
            taskItem.appendChild(deleteBtn);

            tasksList.appendChild(taskItem);

            // Conditions progress bar (async, appended after render)
            fetch(`/api/goal-conditions?task_id=${task.id}`)
                .then(r => r.json())
                .then(conds => {
                    if (!conds.length) return;
                    const done  = conds.filter(c => c.completed).length;
                    const total = conds.length;
                    const pct   = Math.round((done / total) * 100);
                    const bar   = document.createElement('div');
                    bar.className = 'goal-progress-wrap';
                    bar.innerHTML = `
                        <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
                        <span class="goal-progress-label">${done}/${total}</span>
                    `;
                    taskItem.appendChild(bar);
                })
                .catch(() => {});
        });
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
}

async function toggleTask(id, completed) {
    try {
        await fetch('/api/tasks', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, completed: completed ? 1 : 0 })
        });
        loadXP();
        if (completed) loadXPLog();
    } catch (error) {
        console.error('Error updating task:', error);
    }
}

async function deleteTask(id) {
    if (!confirm('Are you sure you want to delete this item?')) return;
    
    try {
        await fetch(`/api/tasks?id=${id}`, { method: 'DELETE' });
        loadAllTasks().then(() => populateConditionsGoalSelect());
    } catch (error) {
        console.error('Error deleting task:', error);
    }
}

// Mastered Recipes
document.getElementById('recipeForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('recipeName')!.value.trim();
    if (!name) return;
    await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name,
            protein_g: parseInt(document.getElementById('recipeProtein')!.value) || 0,
            calories: parseInt(document.getElementById('recipeCalories')!.value) || 0,
            description: document.getElementById('recipeDescription')!.value.trim()
        })
    });
    e.target!.reset();
    loadRecipes();
});

async function loadRecipes() {
    try {
        const res = await fetch('/api/recipes');
        const recipes = await res.json();
        const list = document.getElementById('recipesList')!;
        list.innerHTML = '';
        if (recipes.length === 0) {
            list.innerHTML = '<p style="color:#8b92b0;text-align:center;padding:20px;">No recipes yet.</p>';
            return;
        }
        recipes.forEach(r => {
            const card = document.createElement('div');
            card.className = 'recipe-card';

            const header = document.createElement('div');
            header.className = 'recipe-card-header';

            const nameEl = document.createElement('div');
            nameEl.className = 'recipe-card-name';
            nameEl.textContent = r.name;

            const stats = document.createElement('div');
            stats.className = 'recipe-card-stats';
            if (r.protein_g > 0) {
                const p = document.createElement('span');
                p.className = 'recipe-stat';
                p.textContent = `${r.protein_g}g protein`;
                stats.appendChild(p);
            }
            if (r.calories > 0) {
                const c = document.createElement('span');
                c.className = 'recipe-stat calories';
                c.textContent = `${r.calories} kcal`;
                stats.appendChild(c);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'recipe-card-delete';
            delBtn.textContent = 'Delete';
            delBtn.onclick = async () => {
                if (!confirm(`Delete "${r.name}"?`)) return;
                await fetch(`/api/recipes?id=${r.id}`, { method: 'DELETE' });
                loadRecipes();
            };

            header.appendChild(nameEl);
            header.appendChild(stats);
            header.appendChild(delBtn);
            card.appendChild(header);

            if (r.description) {
                const desc = document.createElement('div');
                desc.className = 'recipe-card-description';
                desc.textContent = r.description;
                card.appendChild(desc);
            }

            list.appendChild(card);
        });
    } catch (err) {
        console.error('Error loading recipes:', err);
    }
}

// Periods
document.getElementById('periodForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('periodTitle')!.value.trim();
    const start = document.getElementById('periodStart')!.value;
    const end = document.getElementById('periodEnd')!.value;
    if (!title || !start || !end) return;
    if (end < start) {
        alert('End month must be after the start month.');
        return;
    }
    await fetch('/api/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, start_date: start, end_date: end })
    });
    e.target!.reset();
    loadPeriods();
});

function formatPeriodMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[m - 1]} ${y}`;
}

function periodMonthSpan(start, end) {
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    const months = (ey - sy) * 12 + (em - sm);
    return months === 1 ? '1 month' : `${months} months`;
}

function buildPeriodGoalRow(g, periodId, isSub) {
    const row = document.createElement('div');
    row.className = (isSub ? 'period-goal-row period-subgoal-row' : 'period-goal-row')
        + (g.completed ? ' completed' : '');

    const tick = document.createElement('div');
    tick.className = 'goal-tick' + (g.completed ? ' goal-tick-done' : '');
    tick.onclick = async () => {
        await fetch('/api/period-goals', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: g.id, completed: g.completed ? 0 : 1 })
        });
        loadPeriods();
    };

    const text = document.createElement('span');
    text.className = 'period-goal-text';
    text.textContent = g.text;

    const rm = document.createElement('button');
    rm.className = 'period-goal-remove';
    rm.textContent = '×';
    rm.title = isSub ? 'Delete sub goal' : 'Delete goal and its sub goals';
    rm.onclick = async () => {
        if (!isSub && g.subgoals && g.subgoals.length > 0 &&
            !confirm(`Delete "${g.text}" and its ${g.subgoals.length} sub goal(s)?`)) return;
        await fetch(`/api/period-goals?id=${g.id}`, { method: 'DELETE' });
        loadPeriods();
    };

    row.appendChild(tick);
    row.appendChild(text);
    row.appendChild(rm);
    return row;
}

function buildPeriodGoalForm(placeholder, onAdd) {
    const form = document.createElement('form');
    form.className = 'period-add-goal-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-input';
    input.placeholder = placeholder;
    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.className = 'btn-primary';
    btn.textContent = 'Add';
    form.appendChild(input);
    form.appendChild(btn);
    form.onsubmit = async (ev) => {
        ev.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        await onAdd(text);
    };
    return form;
}

async function loadPeriods() {
    try {
        const res = await fetch('/api/periods');
        const periods = await res.json();
        const list = document.getElementById('periodsList')!;
        list.innerHTML = '';
        if (periods.length === 0) {
            list.innerHTML = '<p style="color:#8b92b0;text-align:center;padding:20px;">No periods yet.</p>';
            return;
        }
        periods.forEach(p => {
            const card = document.createElement('div');
            card.className = 'period-card';

            const header = document.createElement('div');
            header.className = 'recipe-card-header';

            const titleEl = document.createElement('div');
            titleEl.className = 'recipe-card-name';
            titleEl.textContent = p.title;

            const interval = document.createElement('span');
            interval.className = 'period-interval';
            interval.textContent = `${formatPeriodMonth(p.start_date)} – ${formatPeriodMonth(p.end_date)} · ${periodMonthSpan(p.start_date, p.end_date)}`;

            const delBtn = document.createElement('button');
            delBtn.className = 'recipe-card-delete';
            delBtn.textContent = 'Delete';
            delBtn.onclick = async () => {
                if (!confirm(`Delete "${p.title}" and all its goals?`)) return;
                await fetch(`/api/periods?id=${p.id}`, { method: 'DELETE' });
                loadPeriods();
            };

            header.appendChild(titleEl);
            header.appendChild(interval);
            header.appendChild(delBtn);
            card.appendChild(header);

            const goalsEl = document.createElement('div');
            goalsEl.className = 'period-goal-list';
            p.goals.forEach(g => {
                goalsEl.appendChild(buildPeriodGoalRow(g, p.id, false));
                g.subgoals.forEach(sg => {
                    goalsEl.appendChild(buildPeriodGoalRow(sg, p.id, true));
                });
                const subForm = buildPeriodGoalForm('Add a sub goal...', async (text) => {
                    await fetch('/api/period-goals', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ period_id: p.id, text, parent_id: g.id })
                    });
                    loadPeriods();
                });
                subForm.classList.add('period-subgoal-row');
                goalsEl.appendChild(subForm);
            });
            card.appendChild(goalsEl);

            const addForm = buildPeriodGoalForm('Add a goal to this period...', async (text) => {
                await fetch('/api/period-goals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ period_id: p.id, text })
                });
                loadPeriods();
            });
            card.appendChild(addForm);

            list.appendChild(card);
        });
    } catch (err) {
        console.error('Error loading periods:', err);
    }
}

// ── Goal Conditions ───────────────────────────────────────────

async function populateConditionsGoalSelect() {
    const select = document.getElementById('conditionsGoalSelect')!;
    const current = select.value;
    while (select.options.length > 1) (select as any).remove(1);

    const res = await fetch('/api/tasks?type=goal&period=all');
    const tasks = await res.json();

    const periodLabel = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', lifelong: 'Lifelong', today: 'Today' };
    tasks.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        const label = periodLabel[t.period] || t.period;
        opt.textContent = `[${label}] ${t.task}`;
        select.appendChild(opt);
    });
    if (current) select.value = current;
}

async function loadConditions() {
    const select = document.getElementById('conditionsGoalSelect')!;
    const taskId = select.value;
    const panel = document.getElementById('conditionsPanel')!;
    if (!taskId) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';

    const res = await fetch(`/api/goal-conditions?task_id=${taskId}`);
    const conditions = await res.json();
    const list = document.getElementById('conditionsList')!;
    list.innerHTML = '';
    if (conditions.length === 0) {
        list.innerHTML = '<p class="conditions-empty">No conditions yet.</p>';
        return;
    }
    conditions.forEach(c => {
        const row = document.createElement('div');
        row.className = 'condition-item' + (c.completed ? ' condition-done' : '');
        row.innerHTML = `
            <span class="condition-check" onclick="toggleCondition(${c.id}, ${c.completed ? 0 : 1})">${c.completed ? '✔' : '○'}</span>
            <span class="condition-text">${c.condition_text}</span>
            <button class="task-item-delete" onclick="deleteCondition(${c.id})">✕</button>
        `;
        list.appendChild(row);
    });
}

async function toggleCondition(id, newVal) {
    await fetch('/api/goal-conditions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, completed: newVal })
    });
    loadConditions();
}

async function deleteCondition(id) {
    await fetch(`/api/goal-conditions?id=${id}`, { method: 'DELETE' });
    loadConditions();
}

document.getElementById('conditionAddForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = document.getElementById('conditionsGoalSelect')!.value;
    const text   = document.getElementById('conditionText')!.value.trim();
    if (!taskId || !text) return;
    await fetch('/api/goal-conditions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, condition_text: text })
    });
    document.getElementById('conditionText')!.value = '';
    loadConditions();
});

// ── Yume ──────────────────────────────────────────────────────

async function loadYume() {
    const res = await fetch('/api/yume/categories');
    const cats = await res.json();
    const container = document.getElementById('yumeCategoriesList')!;
    container.innerHTML = '';
    if (cats.length === 0) {
        container.innerHTML = '<p style="color:#8b92b0;text-align:center;padding:40px 0;">No categories yet. Add one above to start your vision board.</p>';
        return;
    }
    for (const cat of cats) {
        const section = document.createElement('div');
        section.className = 'yume-category-section';
        section.id = `yumecat-${cat.id}`;

        const header = document.createElement('div');
        header.className = 'yume-category-header';
        header.innerHTML = `
            <h3 class="yume-category-name">${cat.name}</h3>
            <button class="task-item-delete yume-cat-del" onclick="deleteYumeCategory(${cat.id})">✕</button>
        `;
        section.appendChild(header);

        // Items list
        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'yume-items-list';
        itemsDiv.id = `yume-items-${cat.id}`;
        section.appendChild(itemsDiv);

        // Add item form
        const form = document.createElement('form');
        form.className = 'yume-add-item-form';
        form.innerHTML = `
            <input type="text" class="task-input yume-item-input" placeholder="Add a dream or goal..." required>
            <select class="yume-rank-select">
                <option value="S">S</option>
                <option value="A">A</option>
                <option value="B" selected>B</option>
                <option value="C">C</option>
            </select>
            <button type="submit" class="btn-primary btn-sm">Add</button>
        `;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input  = form.querySelector('input')!;
            const select = form.querySelector('select')!;
            const text = input.value.trim();
            if (!text) return;
            await fetch('/api/yume/items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category_id: cat.id, text, rank: select.value })
            });
            input.value = '';
            await loadYumeItems(cat.id);
        });
        section.appendChild(form);

        // Progress bar placeholder — filled by loadYumeItems
        const progressWrap = document.createElement('div');
        progressWrap.className = 'yume-progress-wrap';
        progressWrap.id = `yume-progress-${cat.id}`;
        header.insertBefore(progressWrap, header.querySelector('.yume-cat-del'));

        container.appendChild(section);
        await loadYumeItems(cat.id);
    }
}

const yumeExpandedCats = new Set();

async function loadYumeItems(catId) {
    const res = await fetch(`/api/yume/items?category_id=${catId}`);
    const items = await res.json();
    const div = document.getElementById(`yume-items-${catId}`)!;
    if (!div) return;
    div.innerHTML = '';
    // Update progress bar
    const progressWrap = document.getElementById(`yume-progress-${catId}`)!;
    if (progressWrap) {
        if (items.length === 0) {
            progressWrap.innerHTML = '';
        } else {
            const done  = items.filter(i => i.completed).length;
            const total = items.length;
            const pct   = Math.round((done / total) * 100);
            progressWrap.innerHTML = `
                <div class="yume-prog-bar"><div class="yume-prog-fill" style="width:${pct}%"></div></div>
                <span class="yume-prog-label">${done}/${total}</span>
            `;
        }
    }

    if (items.length === 0) {
        div.innerHTML = '<p class="yume-empty">No entries yet.</p>';
        return;
    }
    const limit = 3;
    const expanded = yumeExpandedCats.has(catId);
    const visible = expanded ? items : items.slice(0, limit);

    visible.forEach(item => {
        const done = item.completed === 1;
        const row = document.createElement('div');
        row.className = 'yume-item' + (done ? ' yume-item-done' : '');
        row.innerHTML = `
            <span class="yume-rank yume-rank-${(item.rank||'B').toLowerCase()}">${item.rank||'B'}</span>
            <span class="yume-item-text">${item.text}</span>
            <button class="yume-tick${done ? ' yume-tick-done' : ''}" onclick="toggleYumeItem(${item.id}, ${done ? 0 : 1}, ${catId})" title="${done ? 'Mark unfulfilled' : 'Mark fulfilled'}">${done ? '✔' : '○'}</button>
        `;
        div.appendChild(row);
    });

    if (items.length > limit) {
        const toggle = document.createElement('button');
        toggle.className = 'yume-show-more';
        if (expanded) {
            toggle.textContent = 'Show less';
            toggle.onclick = () => { yumeExpandedCats.delete(catId); loadYumeItems(catId); };
        } else {
            toggle.textContent = `Show all (${items.length - limit} more)`;
            toggle.onclick = () => { yumeExpandedCats.add(catId); loadYumeItems(catId); };
        }
        div.appendChild(toggle);
    }
}

async function toggleYumeItem(id, newVal, catId) {
    await fetch('/api/yume/items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, completed: newVal })
    });
    loadYumeItems(catId);
}

async function deleteYumeCategory(id) {
    if (!confirm('Delete this category and all its entries?')) return;
    await fetch(`/api/yume/categories?id=${id}`, { method: 'DELETE' });
    loadYume();
}

document.getElementById('yumeCategoryForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('yumeCategoryName')!.value.trim();
    if (!name) return;
    await fetch('/api/yume/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    document.getElementById('yumeCategoryName')!.value = '';
    loadYume();
});

// Finance functionality
document.getElementById('financeForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const type = document.getElementById('financeType')!.value;
    const amount = parseFloat(document.getElementById('financeAmount')!.value);
    const category = document.getElementById('financeCategory')!.value;
    const description = document.getElementById('financeDescription')!.value;
    const date = document.getElementById('financeDate')!.value;
    
    try {
        const response = await fetch('/api/finance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, amount, category, description, date })
        });
        
        if (response.ok) {
            document.getElementById('financeForm')!.reset();
            document.getElementById('financeDate')!.value = getLocalDateString();
            loadFinance();
            loadXP();
            loadXPLog();
        }
    } catch (error) {
        console.error('Error adding finance:', error);
    }
});

let balanceChartInstance: any = null;
let financeMonthlyChartInstance: any = null;

async function loadFinanceMonthlyChart() {
    try {
        const res  = await fetch('/api/finance/monthly');
        const data = await res.json();
        if (!data.length) return;

        const isLight   = document.documentElement.classList.contains('light-mode');
        const gridColor = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
        const textColor = isLight ? '#555' : '#a0aec0';

        const ctx = document.getElementById('financeMonthlyChart')!.getContext('2d');
        if (financeMonthlyChartInstance) financeMonthlyChartInstance.destroy();
        financeMonthlyChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.month),
                datasets: [
                    { label: 'Income',   data: data.map(d => d.income),   backgroundColor: 'rgba(52,211,153,0.7)',  borderColor: '#34d399', borderWidth: 1 },
                    { label: 'Expenses', data: data.map(d => d.expenses), backgroundColor: 'rgba(239,68,68,0.65)', borderColor: '#ef4444', borderWidth: 1 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textColor } },
                    y: { grid: { color: gridColor }, ticks: { color: textColor } }
                },
                plugins: { legend: { labels: { color: textColor, boxWidth: 12 } } }
            }
        });
    } catch (e) { console.error('Error loading monthly finance chart:', e); }
}

async function loadFinance() {
    try {
        const response = await fetch('/api/finance');
        const records = await response.json();

        let totalIncome = 0;
        let totalExpense = 0;
        let totalCryptoIn = 0;
        let totalCryptoOut = 0;

        records.forEach(record => {
            if (record.type === 'income')              totalIncome    += record.amount;
            else if (record.type === 'expense')        totalExpense   += record.amount;
            else if (record.type === 'crypto_investment') totalCryptoIn  += record.amount;
            else if (record.type === 'crypto_withdrawal') totalCryptoOut += record.amount;
        });

        const currentBalance = totalIncome - totalExpense;
        const currentCrypto  = totalCryptoIn - totalCryptoOut;

        document.getElementById('balance')!.textContent      = `£${currentBalance.toFixed(2)}`;
        document.getElementById('cryptoBalance')!.textContent = `£${currentCrypto.toFixed(2)}`;
        document.getElementById('totalBalance')!.textContent  = `£${(currentBalance + currentCrypto).toFixed(2)}`;
        document.getElementById('brokeMessage')!.style.display =
            (currentBalance < 100000 || currentCrypto < 100000) ? 'block' : 'none';

        // Dual-line balance chart — one point per transaction, shared x-axis
        const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
        let runningSavings = 0;
        let runningCrypto  = 0;
        const chartLabels: any[]  = [];
        const savingsData: any[]  = [];
        const cryptoData: any[]   = [];

        sorted.forEach(record => {
            if (record.type === 'income')                 runningSavings += record.amount;
            else if (record.type === 'expense')           runningSavings -= record.amount;
            else if (record.type === 'crypto_investment') runningCrypto  += record.amount;
            else if (record.type === 'crypto_withdrawal') runningCrypto  -= record.amount;

            chartLabels.push(record.date);
            savingsData.push(parseFloat(runningSavings.toFixed(2)));
            cryptoData.push(parseFloat(runningCrypto.toFixed(2)));
        });

        const isLight = document.documentElement.classList.contains('light-mode');
        const gridColor = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
        const tickColor = isLight ? '#6b7280' : '#8b92b0';
        const legendColor = isLight ? '#374151' : '#e5e7eb';

        const pRgb = cssVar('--color-primary-rgb');
        const aRgb = cssVar('--color-accent-rgb');
        const pColor = cssVar('--color-primary');
        const aColor = cssVar('--color-accent');

        const ctx = document.getElementById('balanceChart')!.getContext('2d');
        if (balanceChartInstance) balanceChartInstance.destroy();
        balanceChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: [
                    {
                        label: 'Savings Balance',
                        data: savingsData,
                        borderColor: pColor,
                        backgroundColor: `rgba(${pRgb}, 0.08)`,
                        borderWidth: 2,
                        pointBackgroundColor: pColor,
                        pointRadius: 3,
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Crypto Balance',
                        data: cryptoData,
                        borderColor: aColor,
                        backgroundColor: `rgba(${aRgb}, 0.06)`,
                        borderWidth: 2,
                        pointBackgroundColor: aColor,
                        pointRadius: 3,
                        fill: true,
                        tension: 0.3
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: legendColor,
                            usePointStyle: true,
                            pointStyleWidth: 10,
                            font: { size: 12, family: 'Inter, sans-serif' }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: tickColor, maxTicksLimit: 6 }, grid: { color: gridColor } },
                    y: { ticks: { color: tickColor, callback: v => '£' + v }, grid: { color: gridColor } }
                }
            }
        });

        const financeList = document.getElementById('financeList')!;
        financeList.innerHTML = '';

        if (records.length === 0) {
            financeList.innerHTML = '<p style="color: #999;">No transactions yet.</p>';
            return;
        }

        const isPositiveType = t => t === 'income' || t === 'crypto_investment';

        function makeFinanceItem(record) {
            const financeItem = document.createElement('div');
            financeItem.className = `finance-item ${record.type}`;
            financeItem.innerHTML = `
                <div class="finance-item-info">
                    <div class="finance-item-category">${record.category || record.type}</div>
                    <div class="finance-item-description">${record.description || ''}</div>
                    <div class="finance-item-date">${record.date}</div>
                </div>
                <div class="finance-item-amount ${record.type}">
                    ${isPositiveType(record.type) ? '+' : '-'}£${record.amount.toFixed(2)}
                </div>
            `;
            return financeItem;
        }

        function renderCollapsed() {
            financeList.innerHTML = '';
            financeList.appendChild(makeFinanceItem(records[0]));
            if (records.length > 1) {
                const btn = document.createElement('button');
                btn.className = 'btn-secondary wins-toggle-btn';
                btn.textContent = `Show All (${records.length})`;
                btn.onclick = renderExpanded;
                financeList.appendChild(btn);
            }
        }

        function renderExpanded() {
            financeList.innerHTML = '';
            records.forEach(r => financeList.appendChild(makeFinanceItem(r)));
            const btn = document.createElement('button');
            btn.className = 'btn-secondary wins-toggle-btn';
            btn.textContent = 'Show Less';
            btn.onclick = renderCollapsed;
            financeList.appendChild(btn);
        }

        renderCollapsed();
        loadFinanceMonthlyChart();
    } catch (error) {
        console.error('Error loading finance:', error);
    }
}

// Initialize finance date
document.getElementById('financeDate')!.value = getLocalDateString();

// Calendar functionality
let currentCalendarDate = new Date();
let selectedDate = new Date();
let calendarEvents: any[] = [];
let monthPointsData = {};

async function loadMonthData(year, month) {
    try {
        const response = await fetch(`/api/month-data?year=${year}&month=${month + 1}`);
        monthPointsData = await response.json();
    } catch (error) {
        console.error('Error loading month data:', error);
        monthPointsData = {};
    }
}

async function renderCalendar() {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    await loadMonthData(year, month);
    
    // Update header
    const monthNames = ["January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December"];
    document.getElementById('currentMonth')!.textContent = `${monthNames[month]} ${year}`;
    
    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    // Adjust for Monday start (0 = Monday, 6 = Sunday)
    const adjustedStart = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;
    
    // Get previous month days
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    
    const calendarDays = document.getElementById('calendarDays')!;
    calendarDays.innerHTML = '';
    
    // Previous month days
    for (let i = adjustedStart - 1; i >= 0; i--) {
        const day = prevMonthLastDay - i;
        const dayDiv = createDayElement(day, true, new Date(year, month - 1, day));
        calendarDays.appendChild(dayDiv);
    }
    
    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dayDiv = createDayElement(day, false, date);
        calendarDays.appendChild(dayDiv);
    }
    
    // Next month days
    const totalCells = calendarDays.children.length;
    const remainingCells = 42 - totalCells; // 6 rows * 7 days
    for (let day = 1; day <= remainingCells; day++) {
        const date = new Date(year, month + 1, day);
        const dayDiv = createDayElement(day, true, date);
        calendarDays.appendChild(dayDiv);
    }
}

function createDayElement(day, otherMonth, date) {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'calendar-day';
    
    if (otherMonth) {
        dayDiv.classList.add('other-month');
    }
    
    // Check if today
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
        dayDiv.classList.add('today');
    }
    
    // Check if selected
    if (date.toDateString() === selectedDate.toDateString()) {
        dayDiv.classList.add('selected');
    }
    
    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = day;
    dayDiv.appendChild(dayNumber);
    
    // Add events for this day
    const dateStr = dateToLocalString(date);
    const dayEvents = calendarEvents.filter(e => e.date === dateStr);
    
    if (dayEvents.length > 0) {
        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'day-events';
        
        dayEvents.slice(0, 3).forEach(event => {
            const miniEvent = document.createElement('div');
            miniEvent.className = `mini-event importance-${event.importance}`;
            miniEvent.textContent = event.title;
            eventsContainer.appendChild(miniEvent);
        });
        
        if (dayEvents.length > 3) {
            const moreIndicator = document.createElement('div');
            moreIndicator.className = 'mini-event';
            moreIndicator.textContent = `+${dayEvents.length - 3} more`;
            eventsContainer.appendChild(moreIndicator);
        }
        
        dayDiv.appendChild(eventsContainer);
    }
    
    // Show logo badge only if score >= 1000 AND all 3 daily goals complete
    const isPastOrToday = date <= today;
    const dayData = monthPointsData[dateToLocalString(date)];
    if (isPastOrToday && !otherMonth && dayData && dayData.points >= 1000 && dayData.goals_all_done) {
        const badge = document.createElement('img');
        badge.src = getThemeIcon();
        badge.className = 'day-logo-badge';
        badge.alt = '';
        dayDiv.appendChild(badge);
    }

    dayDiv.onclick = () => selectDate(date);

    return dayDiv;
}

async function selectDate(date) {
    selectedDate = new Date(date);
    await renderCalendar();
    loadEventsForSelectedDate();
    
    const dateStr = selectedDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    document.getElementById('selectedDate')!.textContent = dateStr;
}

async function previousMonth() {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    await renderCalendar();
}

async function nextMonth() {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    await renderCalendar();
}

async function goToToday() {
    currentCalendarDate = new Date();
    selectedDate = new Date();
    await renderCalendar();
    loadEventsForSelectedDate();
}

// Calendar event form
document.getElementById('calendarEventForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('eventTitle')!.value;
    const date = document.getElementById('eventDate')!.value;
    const startTime = document.getElementById('eventStartTime')!.value;
    const endTime = document.getElementById('eventEndTime')!.value;
    const category = document.getElementById('eventCategory')!.value;
    const importance = document.getElementById('eventImportance')!.value;
    const description = document.getElementById('eventDescription')!.value;
    
    try {
        const response = await fetch('/api/calendar-events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title, date, start_time: startTime, end_time: endTime,
                category, importance, description
            })
        });
        
        if (response.ok) {
            e.target!.reset();
            // Set default date to today
            document.getElementById('eventDate')!.value = getLocalDateString();
            await loadCalendarEvents();
            await renderCalendar();
            loadEventsForSelectedDate();
        }
    } catch (error) {
        console.error('Error adding calendar event:', error);
    }
});

document.getElementById('eventDate')!.value = getLocalDateString();

// AI quick-add: sends a sentence to the parser and prefills the event form.
// It never saves — the user still reviews and presses "Add Event".
document.getElementById('aiParseBtn')!.addEventListener('click', async () => {
    const input = document.getElementById('aiEventText')!;
    const status = document.getElementById('aiEventStatus')!;
    const btn = document.getElementById('aiParseBtn')!;
    const text = input.value.trim();

    if (!text) {
        status.textContent = 'Type what you want to schedule first.';
        status.className = 'ai-event-status error';
        return;
    }

    btn.disabled = true;
    status.textContent = 'Understanding…';
    status.className = 'ai-event-status loading';

    try {
        const response = await fetch('/api/calendar-parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            status.textContent = result.error || 'Could not parse that. Try rewording it.';
            status.className = 'ai-event-status error';
            return;
        }

        const ev = result.event;
        if (ev.title) document.getElementById('eventTitle')!.value = ev.title;
        if (ev.date) document.getElementById('eventDate')!.value = ev.date;
        document.getElementById('eventStartTime')!.value = ev.start_time || '';
        document.getElementById('eventEndTime')!.value = ev.end_time || '';
        if (ev.category) document.getElementById('eventCategory')!.value = ev.category;
        if (ev.importance) document.getElementById('eventImportance')!.value = ev.importance;
        if (ev.description) document.getElementById('eventDescription')!.value = ev.description;

        status.textContent = 'Filled in below — review it, then press Add Event.';
        status.className = 'ai-event-status success';
    } catch (error) {
        console.error('Error parsing calendar event:', error);
        status.textContent = 'Something went wrong. The manual form still works.';
        status.className = 'ai-event-status error';
    } finally {
        btn.disabled = false;
    }
});

async function loadCalendarEvents() {
    try {
        const response = await fetch('/api/calendar-events');
        calendarEvents = await response.json();
    } catch (error) {
        console.error('Error loading calendar events:', error);
    }
}

function loadEventsForSelectedDate() {
    const dateStr = dateToLocalString(selectedDate);
    const dayEvents = calendarEvents.filter(e => e.date === dateStr);
    
    const eventsList = document.getElementById('dayEventsList')!;
    eventsList.innerHTML = '';
    
    if (dayEvents.length === 0) {
        eventsList.innerHTML = '<p style="color: #8b92b0; text-align: center; padding: 20px;">No events for this day.</p>';
        return;
    }
    
    // Sort by time
    dayEvents.sort((a, b) => {
        if (!a.start_time) return 1;
        if (!b.start_time) return -1;
        return a.start_time.localeCompare(b.start_time);
    });
    
    dayEvents.forEach(event => {
        const eventDiv = document.createElement('div');
        eventDiv.className = `calendar-event-item importance-${event.importance}`;
        
        const timeStr = event.start_time
            ? `${event.start_time}${event.end_time ? ' - ' + event.end_time : ''}`
            : 'All day';
        
        eventDiv.innerHTML = `
            <div class="event-header">
                <div>
                    <div class="event-title">${event.title}</div>
                    <div class="event-time">${timeStr}</div>
                </div>
            </div>
            <div class="event-details">
                <span class="event-badge category">${event.category.toUpperCase()}</span>
                <span class="event-badge importance">${event.importance.toUpperCase()}</span>
            </div>
            ${event.description ? `<div class="event-description">${event.description}</div>` : ''}
            <div class="event-actions">
                <button class="btn-delete-event" onclick="deleteCalendarEvent(${event.id})">Delete</button>
            </div>
        `;
        
        eventsList.appendChild(eventDiv);
    });
}

async function deleteCalendarEvent(id) {
    if (!confirm('Are you sure you want to delete this event?')) return;

    try {
        await fetch(`/api/calendar-events?id=${id}`, { method: 'DELETE' });
        await loadCalendarEvents();
        await renderCalendar();
        loadEventsForSelectedDate();
    } catch (error) {
        console.error('Error deleting event:', error);
    }
}

// Reminders functionality
async function checkReminderAlerts() {
    try {
        const response = await fetch('/api/reminders?type=all');
        const reminders = await response.json();
        const now = new Date();
        let hasHighAlert = false;

        for (const r of reminders) {
            if (r.urgency !== 'high' || !r.active) continue;
            // Build the event datetime
            let eventDt: any = null;
            if (r.date) {
                const timeStr = r.time || '00:00';
                eventDt = new Date(`${r.date}T${timeStr}`);
            } else if (r.reminder_type === 'daily' && r.time) {
                // For daily reminders, check today's occurrence
                const todayStr = dateToLocalString(now);
                eventDt = new Date(`${todayStr}T${r.time}`);
            }
            if (!eventDt) continue;
            const msUntil = eventDt - (now as any);
            const noticeMs = (r.notice_hours || 0) * 3600 * 1000;
            // Show alert if we're within the notice window and event hasn't passed
            if (msUntil > 0 && msUntil <= noticeMs) {
                hasHighAlert = true;
                break;
            }
        }

        const badge = document.getElementById('reminderBellBadge')!;
        const heading = document.getElementById('remindersHeading')!;
        if (badge) {
            badge.src = hasHighAlert ? '/static/img/Red_Bell.png' : getThemeBell('low');
            badge.style.display = 'block';
        }
        if (heading) {
            heading.classList.toggle('alert-active', hasHighAlert);
        }
    } catch (e) {
        console.error('Error checking reminder alerts:', e);
    }
}

function getUrgencyFromToggle(toggleId) {
    const toggle = document.getElementById(toggleId)!;
    const active = toggle ? toggle.querySelector('.urgency-btn.active') : null;
    return active ? active.dataset.urgency : 'low';
}

function getNoticeHoursFromInput(inputId) {
    const inp = document.getElementById(inputId)!;
    return inp ? (parseInt(inp.value) || 0) : 0;
}

function setupUrgencyToggle(toggleId, noticeInputId) {
    const toggle = document.getElementById(toggleId)!;
    if (!toggle) return;
    toggle.querySelectorAll('.urgency-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            toggle.querySelectorAll('.urgency-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const inp = document.getElementById(noticeInputId)!;
            if (inp) inp.style.display = btn.dataset.urgency === 'high' ? 'block' : 'none';
        });
    });
}

function setupReminderForms() {
    setupUrgencyToggle('dailyUrgencyToggle', 'dailyNoticeHours');
    setupUrgencyToggle('onetimeUrgencyToggle', 'onetimeNoticeHours');
    setupUrgencyToggle('recurringUrgencyToggle', 'recurringNoticeHours');

    // Daily reminders
    document.getElementById('dailyReminderForm')!.addEventListener('submit', async (e) => {
        e.preventDefault();
        const reminder = e.target!.querySelector('.task-input')!.value;
        const time = document.getElementById('reminderTime')!.value;
        const urgency = getUrgencyFromToggle('dailyUrgencyToggle');
        const notice_hours = getNoticeHoursFromInput('dailyNoticeHours');
        await addReminder(reminder, 'daily', time, null, 0, urgency, notice_hours);
        e.target!.reset();
        // Reset urgency toggle visual
        document.querySelectorAll('#dailyUrgencyToggle .urgency-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('#dailyUrgencyToggle .urgency-low')!.classList.add('active');
        document.getElementById('dailyNoticeHours')!.style.display = 'none';
    });

    // One-time reminders
    document.getElementById('onetimeReminderForm')!.addEventListener('submit', async (e) => {
        e.preventDefault();
        const reminder = e.target!.querySelector('.task-input')!.value;
        const date = document.getElementById('reminderDate')!.value;
        const time = document.getElementById('reminderTimeOnce')!.value;
        const urgency = getUrgencyFromToggle('onetimeUrgencyToggle');
        const notice_hours = getNoticeHoursFromInput('onetimeNoticeHours');
        await addReminder(reminder, 'onetime', time, date, 0, urgency, notice_hours);
        e.target!.reset();
        document.querySelectorAll('#onetimeUrgencyToggle .urgency-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('#onetimeUrgencyToggle .urgency-low')!.classList.add('active');
        document.getElementById('onetimeNoticeHours')!.style.display = 'none';
    });

    // Recurring reminders
    document.getElementById('recurringReminderForm')!.addEventListener('submit', async (e) => {
        e.preventDefault();
        const reminder = e.target!.querySelector('.task-input')!.value;
        const type = document.getElementById('recurringType')!.value;
        const time = document.getElementById('reminderTimeRecurring')!.value;
        const urgency = getUrgencyFromToggle('recurringUrgencyToggle');
        const notice_hours = getNoticeHoursFromInput('recurringNoticeHours');
        await addReminder(reminder, type, time, null, 1, urgency, notice_hours);
        e.target!.reset();
        document.querySelectorAll('#recurringUrgencyToggle .urgency-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('#recurringUrgencyToggle .urgency-low')!.classList.add('active');
        document.getElementById('recurringNoticeHours')!.style.display = 'none';
    });
}

async function addReminder(reminder, reminderType, time, date = null, recurring = 0, urgency = 'low', notice_hours = 0) {
    try {
        const response = await fetch('/api/reminders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reminder, reminder_type: reminderType, time, date, recurring, urgency, notice_hours })
        });

        if (response.ok) {
            loadAllReminders();
            checkReminderAlerts();
        }
    } catch (error) {
        console.error('Error adding reminder:', error);
    }
}

async function loadAllReminders() {
    await loadRemindersByType('daily', 'dailyRemindersList');
    await loadRemindersByType('onetime', 'onetimeRemindersList');
    // Clear recurring list once before the multiple type calls
    document.getElementById('recurringRemindersList')!.innerHTML = '';
    await loadRemindersByType('daily', 'recurringRemindersList', true);
    await loadRemindersByType('weekly', 'recurringRemindersList', true);
    await loadRemindersByType('monthly', 'recurringRemindersList', true);
    // Show empty message if nothing was added
    const recurringList = document.getElementById('recurringRemindersList')!;
    if (recurringList.children.length === 0) {
        recurringList.innerHTML = '<p style="color: #8b92b0; text-align: center; padding: 20px;">No reminders yet.</p>';
    }
}

async function loadRemindersByType(type, listId, recurring = false) {
    try {
        const response = await fetch(`/api/reminders?type=${type}`);
        const reminders = await response.json();
        
        const remindersList = document.getElementById(listId)!;
        
        // For recurring, we append; for others, we replace
        if (!recurring) {
            remindersList.innerHTML = '';
        }
        
        const filteredReminders = recurring 
            ? reminders.filter(r => r.recurring === 1)
            : reminders.filter(r => r.recurring === 0 || !r.recurring);
        
        if (filteredReminders.length === 0 && !recurring) {
            remindersList.innerHTML = '<p style="color: #8b92b0; text-align: center; padding: 20px;">No reminders yet.</p>';
            return;
        }
        
        filteredReminders.forEach(reminder => {
            const reminderItem = document.createElement('div');
            reminderItem.className = 'task-item';

            const timeStr = reminder.time ? ` at ${reminder.time}` : '';
            const dateStr = reminder.date ? ` on ${reminder.date}` : '';
            const typeLabel = reminder.recurring ? reminder.reminder_type + ' ' : '';
            const bellSrc = getThemeBell(reminder.urgency || 'low');

            // Daily reminders recur every day, so they don't get a tick box.
            const checkboxHtml = listId === 'dailyRemindersList'
                ? ''
                : `<input type="checkbox" ${!reminder.active ? 'checked' : ''}
                       onchange="toggleReminder(${reminder.id}, this.checked)">`;

            reminderItem.innerHTML = `
                ${checkboxHtml}
                <img src="${bellSrc}" class="reminder-bell-icon" data-urgency="${reminder.urgency || 'low'}" alt="">
                <div class="task-item-text">${typeLabel}${reminder.reminder}${timeStr}${dateStr}</div>
                <button class="task-item-delete" onclick="deleteReminder(${reminder.id})">Delete</button>
            `;

            remindersList.appendChild(reminderItem);
        });
    } catch (error) {
        console.error('Error loading reminders:', error);
    }
}

async function toggleReminder(id, checked) {
    try {
        await fetch('/api/reminders', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, active: checked ? 0 : 1 })
        });
        loadAllReminders();
    } catch (error) {
        console.error('Error updating reminder:', error);
    }
}

async function deleteReminder(id) {
    if (!confirm('Are you sure you want to delete this reminder?')) return;
    
    try {
        await fetch(`/api/reminders?id=${id}`, { method: 'DELETE' });
        loadAllReminders();
    } catch (error) {
        console.error('Error deleting reminder:', error);
    }
}

// Load initial data
// ── Daily Goals ────────────────────────────────────────────────
const MAX_DAILY_GOALS = 10;
let dailyGoalsState: { text: string; completed: boolean }[] = [{ text: '', completed: false }];

function renderDailyGoalRows() {
    const container = document.getElementById('dailyGoalRows')!;
    const isReadonly = document.getElementById('dailyGoalsCard')!.classList.contains('readonly');
    container.innerHTML = '';

    dailyGoalsState.forEach((goal, i) => {
        const row = document.createElement('div');
        row.className = 'daily-goal-row';

        const area = document.createElement('span');
        area.className = 'goal-check-area';
        const icon = document.createElement('img');
        icon.src = '/static/img/icon-g.png';
        icon.className = 'goal-done-icon';
        icon.alt = '';
        icon.style.display = goal.completed ? 'block' : 'none';
        area.appendChild(icon);
        area.style.pointerEvents = isReadonly ? 'none' : '';
        area.style.opacity = isReadonly ? '0.6' : '';
        area.onclick = () => {
            if (document.getElementById('dailyGoalsCard')!.classList.contains('readonly')) return;
            goal.completed = !goal.completed;
            icon.style.display = goal.completed ? 'block' : 'none';
            saveDailyGoals();
        };

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'goal-text-input';
        input.placeholder = `Goal ${i + 1}...`;
        input.value = goal.text;
        input.disabled = isReadonly;
        input.oninput = () => { goal.text = input.value; };

        row.appendChild(area);
        row.appendChild(input);
        container.appendChild(row);
    });

    const addBtn = document.getElementById('addGoalRowBtn')!;
    addBtn.style.display = (isReadonly || dailyGoalsState.length >= MAX_DAILY_GOALS) ? 'none' : '';
}

function addDailyGoalRow() {
    if (document.getElementById('dailyGoalsCard')!.classList.contains('readonly')) return;
    if (dailyGoalsState.length >= MAX_DAILY_GOALS) return;
    dailyGoalsState.push({ text: '', completed: false });
    renderDailyGoalRows();
    const inputs = document.querySelectorAll('#dailyGoalRows .goal-text-input');
    (inputs[inputs.length - 1] as HTMLInputElement).focus();
}

async function loadDailyGoals(dateStr) {
    const today = getLocalDateString();
    const isPast = dateStr < today;
    const card = document.getElementById('dailyGoalsCard')!;
    const title = document.getElementById('dailyGoalsTitle')!;
    const saveBtn = document.getElementById('saveDailyGoalsBtn')!;

    title.textContent = dateStr === today ? "Today's Goals" : `Goals for ${dateStr}`;

    if (isPast) {
        card.classList.add('readonly');
        saveBtn.style.display = 'none';
    } else {
        card.classList.remove('readonly');
        saveBtn.style.display = '';
    }

    try {
        const response = await fetch(`/api/daily-goals?date=${dateStr}`);
        const data = await response.json();

        dailyGoalsState = (data.goals && data.goals.length > 0)
            ? data.goals
            : [{ text: '', completed: false }];
        renderDailyGoalRows();

        const streakEl  = document.getElementById('dailyStreak')!;
        const streakNum = document.getElementById('dailyStreakCount')!;
        const streak    = data.streak || 0;
        if (streak > 0) {
            streakNum.textContent = streak;
            streakEl.style.display = '';
        } else {
            streakEl.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading daily goals:', error);
    }
}

async function saveDailyGoals() {
    const dateStr = document.getElementById('currentDate')!.value;
    try {
        await fetch('/api/daily-goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: dateStr,
                goals: dailyGoalsState
                    .filter(g => g.text.trim())
                    .map(g => ({ text: g.text.trim(), completed: g.completed ? 1 : 0 }))
            })
        });
        loadXP();
        loadXPLog();
        checkCompleteDay();
    } catch (error) {
        console.error('Error saving daily goals:', error);
    }
}



// ── Health ─────────────────────────────────────────────────────

const MET_VALUES = {
    running:       { light: 7,   moderate: 9,   intense: 12  },
    cycling:       { light: 4,   moderate: 6,   intense: 10  },
    swimming:      { light: 5,   moderate: 7,   intense: 10  },
    walking:       { light: 2.5, moderate: 3.5, intense: 4.5 },
    weightlifting: { light: 3,   moderate: 5,   intense: 6   },
    yoga:          { light: 2.5, moderate: 3,   intense: 4   },
    football:      { light: 6,   moderate: 8,   intense: 10  },
    basketball:    { light: 6,   moderate: 8,   intense: 10  },
    tennis:        { light: 5,   moderate: 7,   intense: 9   },
    other:         { light: 4,   moderate: 6,   intense: 8   }
};

// Activities with a fixed calorie burn rate (calories per minute), independent of weight/intensity
const CAL_PER_MIN = {
    stairmaster: 10   // 10 min → 100 calories
};

// Built-in activities available in the dropdown (value order = display order)
const BUILTIN_ACTIVITIES = [
    'running', 'cycling', 'swimming', 'walking', 'weightlifting',
    'yoga', 'football', 'basketball', 'tennis', 'stairmaster'
];

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

// User-defined custom activities (name -> calories per minute), persisted in localStorage,
// so a saved activity auto-scales its calories to whatever duration is entered next time.
function loadCustomActivities() {
    try { return JSON.parse(localStorage.getItem('customActivities') || '{}'); }
    catch { return {}; }
}
function saveCustomActivity(name, calPerMin) {
    const all = loadCustomActivities();
    all[name] = calPerMin;
    localStorage.setItem('customActivities', JSON.stringify(all));
}
// Built-in activities the user has deleted from the dropdown
function loadHiddenActivities() {
    try { return JSON.parse(localStorage.getItem('hiddenActivities') || '[]'); }
    catch { return []; }
}
// Per-minute rate for an activity, from built-in or saved custom rates (null if none)
function calPerMinFor(type) {
    if (CAL_PER_MIN[type] != null) return CAL_PER_MIN[type];
    const custom = loadCustomActivities();
    return custom[type] != null ? custom[type] : null;
}
// The activities currently shown in the dropdown (built-in + custom, minus deleted)
function listActivities() {
    const hidden = loadHiddenActivities();
    const custom = loadCustomActivities();
    return [
        ...BUILTIN_ACTIVITIES.filter(a => !hidden.includes(a)),
        ...Object.keys(custom).filter(a => !hidden.includes(a))
    ];
}
// Rebuild the activity dropdown from the current activity list
function renderActivityOptions() {
    const select = document.getElementById('activityType')!;
    if (!select) return;
    const current = select.value;
    select.innerHTML = '';
    listActivities().forEach(value => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = capitalize(value);
        select.appendChild(opt);
    });
    const otherOpt = document.createElement('option');
    otherOpt.value = 'other';
    otherOpt.textContent = 'Other…';
    select.appendChild(otherOpt);
    if ([...select.options].some(o => o.value === current)) select.value = current;
}
// Delete an activity from the dropdown: drop a custom one entirely, or hide a built-in
function deleteActivityOption(value) {
    const custom = loadCustomActivities();
    if (custom[value] != null) {
        delete custom[value];
        localStorage.setItem('customActivities', JSON.stringify(custom));
    } else {
        const hidden = loadHiddenActivities();
        if (!hidden.includes(value)) {
            hidden.push(value);
            localStorage.setItem('hiddenActivities', JSON.stringify(hidden));
        }
    }
    renderActivityOptions();
    renderEditActivitiesList();
}
// Render the "Edit activities" panel: each current activity with a delete button
function renderEditActivitiesList() {
    const listEl = document.getElementById('activityEditList')!;
    if (!listEl) return;
    const items = listActivities();
    listEl.innerHTML = '';
    if (items.length === 0) {
        listEl.innerHTML = '<p class="activity-edit-empty">No activities.</p>';
        return;
    }
    items.forEach(value => {
        const row = document.createElement('div');
        row.className = 'activity-edit-item';
        const name = document.createElement('span');
        name.textContent = capitalize(value);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'activity-edit-del';
        del.textContent = '✕';
        del.addEventListener('click', () => deleteActivityOption(value));
        row.appendChild(name);
        row.appendChild(del);
        listEl.appendChild(row);
    });
}
// Wire up the three-dots menu and the edit panel
function setupActivityMenu() {
    const menuBtn = document.getElementById('activityMenuBtn')!;
    const menu    = document.getElementById('activityMenu')!;
    const editBtn = document.getElementById('editActivitiesBtn')!;
    const panel   = document.getElementById('activityEditPanel')!;
    if (!menuBtn || !menu || !editBtn || !panel) return;

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
    });
    editBtn.addEventListener('click', () => {
        menu.classList.remove('open');
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) renderEditActivitiesList();
    });
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target as Node) && e.target !== menuBtn) menu.classList.remove('open');
    });
}

const ACTIVITY_MULTIPLIERS = {
    sedentary:          1.2,
    lightly_active:     1.375,
    moderately_active:  1.55,
    very_active:        1.725,
    athlete:            1.9
};

let macroChartInstance: any = null;
let nutritionWeekChartInstance: any = null;
let healthMetricsCache: any = { weight_kg: 70, calorie_target: 0, protein_target: 0, calorie_mode: 'average', calorie_deficit: 0 };

// `activity_log` mode treats maintenance as BMR×1.2 (sedentary base) plus
// whatever the user actually burned today — so the target shifts as new
// activities are logged. `average` mode uses the static intensity multiplier.
function computeMaintenance(activityBurnedToday = 0) {
    const m = healthMetricsCache;
    if (!m.weight_kg || !m.height_cm || !m.age) return 0;
    const bmr = m.sex === 'male'
        ? (10 * m.weight_kg) + (6.25 * m.height_cm) - (5 * m.age) + 5
        : (10 * m.weight_kg) + (6.25 * m.height_cm) - (5 * m.age) - 161;
    let result;
    if (m.calorie_mode === 'activity_log') {
        result = Math.round(bmr * 1.2 + (activityBurnedToday || 0));
    } else {
        const mult = ACTIVITY_MULTIPLIERS[m.exercise_intensity || 'sedentary'] || 1.2;
        result = Math.round(bmr * mult);
    }
    console.log('[computeMaintenance]', {
        calorie_mode: m.calorie_mode,
        activityBurnedToday,
        bmr: Math.round(bmr),
        result
    });
    return result;
}

function applyEffectiveTarget(activityBurnedToday = 0) {
    const maintenance = computeMaintenance(activityBurnedToday);
    const target = Math.max(0, maintenance - (healthMetricsCache.calorie_deficit || 0));
    healthMetricsCache.calorie_maintenance = maintenance;
    healthMetricsCache.calorie_target = target;
    // Body Metrics shows full maintenance calories; the deficit is applied only in Daily Summary.
    const tEl = document.getElementById('targetCalories')!;
    if (tEl) tEl.textContent = maintenance || '—';
    console.log('[applyEffectiveTarget]', {
        maintenance,
        deficit: healthMetricsCache.calorie_deficit || 0,
        target,
        domSetTo: tEl ? tEl.textContent : '(no element)'
    });
    return target;
}

const averageRangePlugin = {
    id: 'averageRange',
    afterDraw(chart) {
        const opts = chart.options.plugins && chart.options.plugins.averageRange;
        if (!opts || opts.startIndex == null || opts.endIndex == null) return;
        const xScale = chart.scales.x;
        if (!xScale) return;
        const startX = xScale.getPixelForValue(opts.startIndex);
        const endX   = xScale.getPixelForValue(opts.endIndex);
        if (startX == null || endX == null) return;
        const y = xScale.bottom + 14;
        const ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = opts.color || 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(startX, y - 3); ctx.lineTo(startX, y + 3);
        ctx.moveTo(endX,   y - 3); ctx.lineTo(endX,   y + 3);
        ctx.stroke();
        ctx.restore();
    }
};
if (typeof Chart !== 'undefined') Chart.register(averageRangePlugin);

function toggleMetricsForm() {
    const form = document.getElementById('healthMetricsForm')!;
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function loadHealthMetrics() {
    try {
        const res = await fetch('/api/health-metrics');
        const data = await res.json();
        healthMetricsCache = data;

        // Prefer the Daily Weight rolling average over the stored weight so the
        // BMR/calorie maths always tracks the user's recent average.
        if (weightAvgKg != null) healthMetricsCache.weight_kg = weightAvgKg;

        // Populate form
        document.getElementById('hmWeight')!.value       = healthMetricsCache.weight_kg || '';
        document.getElementById('hmHeight')!.value       = data.height_cm    || '';
        document.getElementById('hmAge')!.value          = data.age          || '';
        document.getElementById('hmSex')!.value          = data.sex          || 'male';
        document.getElementById('hmIntensity')!.value    = data.exercise_intensity || 'sedentary';
        document.getElementById('hmWeightTarget')!.value = data.weight_target || '';
        document.getElementById('hmDeficit')!.value      = data.calorie_deficit || '';

        const mode = data.calorie_mode || 'average';
        console.log('[loadHealthMetrics] raw data:', data);
        console.log('[loadHealthMetrics] resolved mode:', mode);
        document.querySelectorAll('#calorieModeToggle .calc-mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
        document.getElementById('hmIntensity')!.disabled = (mode === 'activity_log');

        // For activity_log mode the displayed target must be recomputed from
        // BMR×1.2 + today's burned (the stored value is just the rest base).
        let burned = 0;
        if (mode === 'activity_log') {
            const dateStr = document.getElementById('healthDate')!.value || getLocalDateString();
            try {
                const actRes = await fetch(`/api/activity-log?date=${dateStr}`);
                const acts = await actRes.json();
                burned = acts.reduce((s, a) => s + (a.calories_burned || 0), 0);
                console.log('[loadHealthMetrics] activities fetched:', acts, 'burned sum:', burned);
            } catch (e) { console.warn('[loadHealthMetrics] activity fetch failed:', e); }
        }
        // Compute maintenance (shown in Body Metrics) and the deficit-adjusted
        // target (used by Daily Summary) live from the current metrics.
        const effectiveTarget = applyEffectiveTarget(burned);
        console.log('[loadHealthMetrics] effectiveTarget after apply:', effectiveTarget);

        if (effectiveTarget > 0) {
            document.getElementById('targetProtein')!.textContent  = data.protein_target;
            document.getElementById('healthTargetsRow')!.style.display = 'flex';
            document.getElementById('healthMetricsForm')!.style.display = 'none';
        } else {
            document.getElementById('healthMetricsForm')!.style.display = 'block';
        }
        updateFoodSummary();
    } catch (err) {
        console.error('Error loading health metrics:', err);
    }
}

document.getElementById('calorieModeToggle')!.addEventListener('click', (e) => {
    const btn = e.target!.closest('.calc-mode-btn');
    if (!btn) return;
    document.querySelectorAll('#calorieModeToggle .calc-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('hmIntensity')!.disabled = (btn.dataset.mode === 'activity_log');
});

document.getElementById('healthMetricsForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const weight   = parseFloat(document.getElementById('hmWeight')!.value);
    const height   = parseFloat(document.getElementById('hmHeight')!.value);
    const age      = parseInt(document.getElementById('hmAge')!.value);
    const sex      = document.getElementById('hmSex')!.value;
    const intensity = document.getElementById('hmIntensity')!.value;

    // Mifflin-St Jeor BMR
    const bmr = sex === 'male'
        ? (10 * weight) + (6.25 * height) - (5 * age) + 5
        : (10 * weight) + (6.25 * height) - (5 * age) - 161;

    const activeMode = document.querySelector('#calorieModeToggle .calc-mode-btn.active')!;
    const mode = activeMode ? activeMode.dataset.mode : 'average';
    const deficit  = Math.max(0, parseInt(document.getElementById('hmDeficit')!.value) || 0);
    const baseMaint = mode === 'activity_log'
        ? Math.round(bmr * 1.2)
        : Math.round(bmr * ACTIVITY_MULTIPLIERS[intensity]);
    const calorie_target = Math.max(0, baseMaint - deficit);
    const protein_target = Math.round(weight * 2);
    try {
        await fetch('/api/health-metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                weight_kg: weight, height_cm: height, age, sex,
                exercise_intensity: intensity,
                calorie_target, protein_target,
                weight_target: parseFloat(document.getElementById('hmWeightTarget')!.value) || 0,
                calorie_deficit: deficit,
                calorie_mode: mode
            })
        });
        loadHealthMetrics();
    } catch (err) {
        console.error('Error saving health metrics:', err);
    }
});

// Food log
async function loadFoodLog(dateStr) {
    try {
        const res = await fetch(`/api/food-log?date=${dateStr}`);
        const entries = await res.json();

        const today = getLocalDateString();
        document.getElementById('healthDateLabel')!.textContent =
            dateStr === today ? "Today's Log" : `Log for ${dateStr}`;

        ['breakfast', 'lunch', 'dinner', 'snacks'].forEach(meal => {
            const list = document.getElementById(`list${meal.charAt(0).toUpperCase() + meal.slice(1)}`)!;
            list.innerHTML = '';
            const mealEntries = entries.filter(e => e.meal === meal);
            if (mealEntries.length === 0) {
                list.innerHTML = '<p class="health-empty">No entries yet.</p>';
                return;
            }
            mealEntries.forEach(entry => {
                const row = document.createElement('div');
                row.className = 'health-food-item';
                row.innerHTML = `
                    <div class="health-food-item-info">
                        <span class="health-food-name">${entry.food_name}</span>
                        <span class="health-food-macros">${entry.calories} kcal &nbsp;|&nbsp; P: ${entry.protein_g}g</span>
                    </div>
                    <button class="task-item-delete" onclick="deleteFoodEntry(${entry.id})">Delete</button>
                `;
                list.appendChild(row);
            });
        });
        updateFoodSummary(entries);
        loadMealPattern();
        loadWeeklyHealthSummary();
    } catch (err) {
        console.error('Error loading food log:', err);
    }
}

async function loadMealPattern() {
    try {
        const res = await fetch('/api/meal-pattern');
        const data = await res.json();
        const bars  = document.getElementById('mealComboBars')!;
        const usual = document.getElementById('mealPatternUsual')!;
        const strip = document.getElementById('mealStrip')!;
        bars.innerHTML = '';
        strip.innerHTML = '';
        usual.textContent = '';

        const combos = [
            { key: 'breakfast+lunch',  label: 'Breakfast + Lunch'  },
            { key: 'breakfast+dinner', label: 'Breakfast + Dinner' },
            { key: 'lunch+dinner',     label: 'Lunch + Dinner'     },
            { key: 'all_three',        label: 'All three'          }
        ].map(c => ({ ...c, count: data.combos[c.key] || 0 }));

        const max = Math.max(1, ...combos.map(c => c.count));
        combos.forEach(c => {
            if (c.key === 'all_three' && c.count === 0) return;
            const row = document.createElement('div');
            row.className = 'meal-combo-row';
            row.innerHTML = `
                <span class="meal-combo-label">${c.label}</span>
                <span class="meal-combo-bar-wrap"><span class="meal-combo-bar-fill" style="width:${Math.round(c.count / max * 100)}%"></span></span>
                <span class="meal-combo-count">${c.count} day${c.count === 1 ? '' : 's'}</span>
            `;
            bars.appendChild(row);
        });

        const best = combos.reduce((a, b) => (b.count > a.count ? b : a));
        if (best.count > 0) {
            usual.textContent = `Usual pattern: ${best.label} (${best.count} of ${data.days_logged} logged days)`;
        }

        // 14-day strip: header of weekday letters, then one dot row per meal
        const header = document.createElement('div');
        header.className = 'meal-strip-row';
        header.innerHTML = '<span class="meal-strip-label"></span>' +
            data.strip.map(d => `<span class="meal-strip-day">${d.day}</span>`).join('');
        strip.appendChild(header);

        [['B', 'breakfast'], ['L', 'lunch'], ['D', 'dinner']].forEach(([letter, meal]) => {
            const row = document.createElement('div');
            row.className = 'meal-strip-row';
            row.innerHTML = `<span class="meal-strip-label">${letter}</span>` +
                data.strip.map(d =>
                    `<span class="meal-dot${d[meal] ? ' meal-dot-filled' : ''}" title="${d.date}"></span>`
                ).join('');
            strip.appendChild(row);
        });
    } catch (err) {
        console.error('Error loading meal pattern:', err);
    }
}

let activeMeal = 'breakfast';

async function loadRecentFoods() {
    try {
        const res = await fetch('/api/food-log/recent');
        const foods = await res.json();
        const bar   = document.getElementById('recentFoodsBar')!;
        const chips = document.getElementById('recentFoodsChips')!;
        if (!foods.length) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        chips.innerHTML = '';
        foods.forEach(f => {
            const chip = document.createElement('button');
            chip.className = 'recent-food-chip';
            chip.textContent = f.food_name;
            chip.title = `${f.calories} kcal · P: ${f.protein_g}g`;
            chip.onclick = () => {
                const cap = activeMeal.charAt(0).toUpperCase() + activeMeal.slice(1);
                document.getElementById(`foodName${cap}`)!.value = f.food_name;
                document.getElementById(`foodCal${cap}`)!.value  = f.calories;
                document.getElementById(`foodProt${cap}`)!.value = f.protein_g;
            };
            chips.appendChild(chip);
        });
    } catch (e) { /* silent */ }
}

async function addFoodEntry(meal) {
    activeMeal = meal;
    const cap   = meal.charAt(0).toUpperCase() + meal.slice(1);
    const name  = document.getElementById(`foodName${cap}`)!.value.trim();
    if (!name) return;
    const cal   = parseFloat(document.getElementById(`foodCal${cap}`)!.value)  || 0;
    const prot  = parseFloat(document.getElementById(`foodProt${cap}`)!.value) || 0;
    const date  = document.getElementById('healthDate')!.value;

    try {
        await fetch('/api/food-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, meal, food_name: name, calories: cal, protein_g: prot })
        });
        // Clear inputs
        ['foodName', 'foodCal', 'foodProt'].forEach(prefix => {
            document.getElementById(`${prefix}${cap}`)!.value = '';
        });
        loadFoodLog(date);
        loadActivityLog(date);
        loadNutritionWeekChart();
        loadRecentFoods();
        loadXP();
        loadXPLog();
    } catch (err) {
        console.error('Error adding food entry:', err);
    }
}

async function deleteFoodEntry(id) {
    const date = document.getElementById('healthDate')!.value;
    try {
        await fetch(`/api/food-log?id=${id}`, { method: 'DELETE' });
        loadFoodLog(date);
        loadActivityLog(date);
        loadNutritionWeekChart();
    } catch (err) {
        console.error('Error deleting food entry:', err);
    }
}

async function loadWeeklyHealthSummary() {
    try {
        const res = await fetch('/api/health-week-summary');
        const d = await res.json();

        const deficitEl = document.getElementById('weekAvgDeficit')!;
        deficitEl.textContent = d.avg_deficit != null ? d.avg_deficit : '—';
        deficitEl.style.color = (d.avg_deficit != null && d.avg_deficit < 0) ? '#ef4444' : '';

        document.getElementById('weekAvgProtein')!.textContent =
            d.avg_protein != null ? `${d.avg_protein}` : '—';
        document.getElementById('weekAvgWeight')!.textContent =
            d.avg_weight != null ? `${d.avg_weight}` : '—';
        document.getElementById('weekAvgBurned')!.textContent =
            d.avg_calories_burned != null ? `${d.avg_calories_burned}` : '—';
    } catch (err) {
        console.error('Error loading weekly health summary:', err);
    }
}

async function updateFoodSummary(entries?) {
    if (!entries) {
        const date = document.getElementById('healthDate')!.value;
        try {
            const res = await fetch(`/api/food-log?date=${date}`);
            entries = await res.json();
        } catch { entries = []; }
    }

    let totalCal = 0, totalProt = 0;
    entries.forEach(e => {
        totalCal  += e.calories  || 0;
        totalProt += e.protein_g || 0;
    });

    const target = healthMetricsCache.calorie_target || 0;
    const pct    = target > 0 ? Math.min((totalCal / target) * 100, 100) : 0;
    const over   = target > 0 && totalCal > target;

    document.getElementById('summaryCalConsumed')!.textContent = Math.round(totalCal) as any;
    document.getElementById('summaryCalTarget')!.textContent   = (target > 0 ? target : '—') as any;

    // Daily Summary target already has the deficit applied — note how much.
    const deficit = healthMetricsCache.calorie_deficit || 0;
    const deficitEl = document.getElementById('summaryCalDeficit')!;
    if (deficitEl) deficitEl.textContent = (target > 0 && deficit > 0) ? ` (${deficit} deficit)` : '';
    document.getElementById('summaryProtein')!.textContent     = totalProt.toFixed(1);
    document.getElementById('summaryCalTotal')!.textContent    = Math.round(totalCal) as any;

    // Calories / protein remaining for the day = target − already eaten
    const protTarget = healthMetricsCache.protein_target || 0;
    const calLeftEl  = document.getElementById('summaryCalLeft')!;
    const protLeftEl = document.getElementById('summaryProtLeft')!;
    if (calLeftEl) {
        const calLeft = Math.round(target - totalCal);
        calLeftEl.textContent = target > 0 ? `${calLeft} kcal` : '—';
        calLeftEl.style.color = (target > 0 && calLeft < 0) ? '#ef4444' : '';
    }
    if (protLeftEl) protLeftEl.textContent = protTarget > 0  ? `${Math.max(0, protTarget - totalProt).toFixed(1)} g` : '—';

    const bar = document.getElementById('caloriesBarFill')!;
    bar.style.width = pct + '%';
    bar.style.background = over ? '#ef4444' : '#00c9a7';

    // Macro doughnut
    const ctx = document.getElementById('macroChart')!.getContext('2d');
    if (macroChartInstance) macroChartInstance.destroy();
    const hasData = totalProt > 0 || totalCal > 0;
    const protCal = totalProt * 4;
    const otherCal = Math.max(0, totalCal - protCal);
    macroChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [`Protein (${Math.round(protCal)} kcal)`, `Other (${Math.round(otherCal)} kcal)`],
            datasets: [{
                data: hasData ? [protCal, otherCal] : [1, 1],
                backgroundColor: hasData
                    ? ['#00c9a7', '#c084fc']
                    : ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.08)'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            cutout: '65%',
            plugins: { legend: { display: false } }
        }
    });
}

async function loadNutritionWeekChart() {
    try {
        const res = await fetch('/api/nutrition-week');
        const data = await res.json();
        const labels = data.map(d => {
            const dt = new Date(d.date + 'T00:00:00');
            return dt.toLocaleDateString('en-US', { weekday: 'short' });
        });
        const calories = data.map(d => d.calories);
        const protein  = data.map(d => d.protein);

        const today = getLocalDateString();
        const priorIdx = data
            .map((d, i) => ({ d, i }))
            .filter(x => x.d.date !== today);
        const avgCal = priorIdx.length
            ? priorIdx.reduce((s, x) => s + (x.d.calories || 0), 0) / priorIdx.length
            : 0;
        const avgProt = priorIdx.length
            ? priorIdx.reduce((s, x) => s + (x.d.protein  || 0), 0) / priorIdx.length
            : 0;
        const avgCalEl  = document.getElementById('nutritionAvgCal')!;
        const avgProtEl = document.getElementById('nutritionAvgProt')!;
        if (avgCalEl)  avgCalEl.textContent  = priorIdx.length ? `${Math.round(avgCal)} kcal` : '—';
        if (avgProtEl) avgProtEl.textContent = priorIdx.length ? `${avgProt.toFixed(1)} g`    : '—';

        const startIndex = priorIdx.length ? priorIdx[0].i                       : null;
        const endIndex   = priorIdx.length ? priorIdx[priorIdx.length - 1].i     : null;

        const ctx = document.getElementById('nutritionWeekChart')!.getContext('2d');
        if (nutritionWeekChartInstance) nutritionWeekChartInstance.destroy();

        const isLight  = document.documentElement.getAttribute('data-mode') === 'light';
        const gridColor = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
        const textColor = isLight ? '#555' : '#a0aec0';
        const rangeColor = isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';

        nutritionWeekChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Calories (kcal)',
                        data: calories,
                        backgroundColor: 'rgba(251,146,60,0.7)',
                        borderColor: '#fb923c',
                        borderWidth: 1,
                        yAxisID: 'yLeft'
                    },
                    {
                        label: 'Protein (g)',
                        data: protein,
                        backgroundColor: 'rgba(52,211,153,0.7)',
                        borderColor: '#34d399',
                        borderWidth: 1,
                        yAxisID: 'yRight'
                    }
                ]
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { bottom: 22 } },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textColor } },
                    yLeft: {
                        type: 'linear', position: 'left',
                        grid: { color: gridColor },
                        ticks: { color: '#fb923c' },
                        title: { display: true, text: 'kcal', color: '#fb923c', font: { size: 11 } }
                    },
                    yRight: {
                        type: 'linear', position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#34d399' },
                        title: { display: true, text: 'protein g', color: '#34d399', font: { size: 11 } }
                    }
                },
                plugins: {
                    legend: { labels: { color: textColor, boxWidth: 12 } },
                    averageRange: { startIndex, endIndex, color: rangeColor }
                }
            }
        });
    } catch (err) {
        console.error('Error loading nutrition week chart:', err);
    }
}

// Water tracker
function getWaterTarget() {
    const stored = parseFloat(localStorage.getItem('water_target')!);
    return isNaN(stored) || stored <= 0 ? 2.5 : stored;
}

function saveWaterTarget(val) {
    const v = parseFloat(val);
    if (!isNaN(v) && v > 0) localStorage.setItem('water_target', v as any);
}

function getWaterEntries(dateStr) {
    try { return JSON.parse(localStorage.getItem(`water_entries_${dateStr}`)!) || []; }
    catch { return []; }
}

function saveWaterEntries(dateStr, entries) {
    localStorage.setItem(`water_entries_${dateStr}`, JSON.stringify(entries));
}

function loadWater(dateStr) {
    const targetInput = document.getElementById('waterTarget')!;
    if (targetInput) targetInput.value = getWaterTarget();
    renderWater(dateStr, getWaterEntries(dateStr));
}

function addWater(dateStr) {
    const input = document.getElementById('waterInput')!;
    const amount = parseFloat(input.value);
    if (!amount || amount <= 0) return;
    const entries = getWaterEntries(dateStr);
    entries.push({ id: Date.now(), amount: Math.round(amount * 100) / 100 });
    saveWaterEntries(dateStr, entries);
    renderWater(dateStr, entries);
    input.value = '';
}

function deleteWaterEntry(dateStr, id) {
    const entries = getWaterEntries(dateStr).filter(e => e.id !== id);
    saveWaterEntries(dateStr, entries);
    renderWater(dateStr, entries);
}

function renderWater(dateStr, entries) {
    const total = Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const target = getWaterTarget();
    const pct = target > 0 ? Math.min((total / target) * 100, 100) : 0;

    document.getElementById('waterCount')!.textContent = total.toFixed(2);
    const bar = document.getElementById('waterBarFill')!;
    bar.style.width = pct + '%';
    bar.style.background = total >= target ? 'var(--color-accent-dark)' : 'var(--color-accent)';

    const list = document.getElementById('waterEntryList')!;
    list.innerHTML = '';
    entries.forEach(e => {
        const row = document.createElement('div');
        row.className = 'health-food-item';
        row.innerHTML = `
            <div class="health-food-item-info">
                <span class="health-food-name">${e.amount.toFixed(2)} L</span>
            </div>
            <button class="task-item-delete" onclick="deleteWaterEntry('${dateStr}', ${e.id})">Delete</button>
        `;
        list.appendChild(row);
    });
}

// Activity log
async function loadActivityLog(dateStr) {
    try {
        const [actRes, foodRes] = await Promise.all([
            fetch(`/api/activity-log?date=${dateStr}`),
            fetch(`/api/food-log?date=${dateStr}`)
        ]);
        const activities = await actRes.json();
        const foods      = await foodRes.json();

        const list = document.getElementById('activityList')!;
        list.innerHTML = '';
        if (activities.length === 0) {
            list.innerHTML = '<p class="health-empty">No activities logged.</p>';
        } else {
            activities.forEach(a => {
                const row = document.createElement('div');
                row.className = 'health-activity-item';
                const label = a.activity_type.charAt(0).toUpperCase() + a.activity_type.slice(1);
                row.innerHTML = `
                    <div class="activity-item-info">
                        <span class="activity-item-name">${label}</span>
                        <span class="activity-item-detail">${a.duration_mins} min &nbsp;·&nbsp; ${a.intensity}</span>
                    </div>
                    <span class="activity-item-burned">−${a.calories_burned} kcal</span>
                    <button class="task-item-delete" onclick="deleteActivityLog(${a.id})">Delete</button>
                `;
                list.appendChild(row);
            });
        }

        const burned = activities.reduce((s, a) => s + (a.calories_burned || 0), 0);

        if (healthMetricsCache.calorie_mode === 'activity_log'
            && dateStr === getLocalDateString()) {
            applyEffectiveTarget(burned);
            updateFoodSummary(foods);
        }

        document.getElementById('activityBurnedValue')!.textContent = `${Math.round(burned)} kcal`;
        loadWeeklyHealthSummary();
    } catch (err) {
        console.error('Error loading activity log:', err);
    }
}

// Show custom name / calories inputs when "Other" is selected
document.getElementById('activityType')!.addEventListener('change', (e) => {
    const isOther = e.target!.value === 'other';
    const nameInput = document.getElementById('activityTypeOther')!;
    const calInput  = document.getElementById('activityCaloriesOther')!;
    nameInput.classList.toggle('visible', isOther);
    calInput.classList.toggle('visible', isOther);
    nameInput.required = isOther;
    if (!isOther) { nameInput.value = ''; calInput.value = ''; }
});

document.getElementById('activityLogForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    let type        = document.getElementById('activityType')!.value;
    const duration  = parseInt(document.getElementById('activityDuration')!.value) || 0;
    const intensity = document.getElementById('activityIntensity')!.value;
    const date      = document.getElementById('healthDate')!.value;
    const weight    = healthMetricsCache.weight_kg || 70;

    if (type === 'other') {
        const customName = document.getElementById('activityTypeOther')!.value.trim();
        if (!customName) return;
        type = customName;
        const ratePer30Min = parseFloat(document.getElementById('activityCaloriesOther')!.value);
        // Stored internally as calories per minute so it auto-scales to any duration entered next time.
        if (!isNaN(ratePer30Min) && ratePer30Min > 0) {
            saveCustomActivity(customName, ratePer30Min / 30);
            renderActivityOptions();
        }
    }

    let calories_burned;
    const rate = calPerMinFor(type);
    if (rate != null) {
        calories_burned = Math.round(rate * duration);
    } else {
        const met = (MET_VALUES[type] || MET_VALUES.other)[intensity];
        calories_burned = Math.round(met * weight * (duration / 60));
    }

    try {
        await fetch('/api/activity-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, activity_type: type, duration_mins: duration, intensity, calories_burned })
        });
        document.getElementById('activityLogForm')!.reset();
        document.getElementById('activityType')!.dispatchEvent(new Event('change'));
        loadActivityLog(date);
    } catch (err) {
        console.error('Error logging activity:', err);
    }
});

async function deleteActivityLog(id) {
    const date = document.getElementById('healthDate')!.value;
    try {
        await fetch(`/api/activity-log?id=${id}`, { method: 'DELETE' });
        loadActivityLog(date);
    } catch (err) {
        console.error('Error deleting activity:', err);
    }
}

document.getElementById('healthDate')!.addEventListener('change', (e) => {
    const dateStr = e.target!.value;
    loadFoodLog(dateStr);
    loadActivityLog(dateStr);
    loadWater(dateStr);
});

// ── Weight Log ─────────────────────────────────────────────────

let weightChartInstance: any = null;
let weightLogData: any[] = [];
let weightChartRange = '2W';   // default range on load
let weightAvgKg: any = null;        // rolling average that auto-fills Body Metrics weight
const WEIGHT_RANGE_DAYS = { '1W': 7, '2W': 14, '1M': 30, '5M': 150, '1Y': 365 };

async function loadWeightLog() {
    try {
        const res = await fetch('/api/weight-log');
        weightLogData = await res.json();
        const data = weightLogData;

        // Update today's weight in Daily Summary
        const today = getLocalDateString();
        const todayEntry = data.find(d => d.date === today);
        const summaryWeight = document.getElementById('summaryWeight')!;
        if (summaryWeight) summaryWeight.textContent = todayEntry ? todayEntry.weight_kg + ' kg' : '—';

        // ── Average weight (UNCHANGED): past 7 days including today ──
        const todayDate = new Date(today + 'T00:00:00');
        const msFor = ds => new Date(ds + 'T00:00:00').getTime();
        const startBound = new Date(todayDate); startBound.setDate(startBound.getDate() - 7);
        const endBound   = new Date(todayDate);
        const windowEntries = data.filter(d => {
            const t = msFor(d.date);
            return t >= startBound.getTime() && t <= endBound.getTime();
        });
        const avgWeight = windowEntries.length
            ? windowEntries.reduce((s, d) => s + (d.weight_kg || 0), 0) / windowEntries.length
            : 0;
        const avgEl = document.getElementById('weightAvgDisplay')!;
        if (avgEl) avgEl.textContent = windowEntries.length ? `${avgWeight.toFixed(1)} kg` : '—';

        // Auto-fill the Body Metrics weight from this rolling average. Re-render the
        // health metrics (and calorie targets) only when the average actually changes.
        const newAvg = windowEntries.length ? parseFloat(avgWeight.toFixed(1)) : null;
        if (newAvg !== weightAvgKg) {
            weightAvgKg = newAvg;
            if (weightAvgKg != null) loadHealthMetrics();
        }

        renderWeightChart();
        loadWeeklyHealthSummary();
    } catch (e) {
        console.error('Error loading weight log:', e);
    }
}

// Draw the weight chart filtered to the selected time range, crypto-chart style.
function renderWeightChart() {
    const canvas = document.getElementById('weightChart')!;
    if (!canvas) return;
    const data = weightLogData;

    const today = getLocalDateString();
    const todayDate = new Date(today + 'T00:00:00');
    const msFor = ds => new Date(ds + 'T00:00:00').getTime();

    // Filter to the selected range, up to today
    const rangeDays = WEIGHT_RANGE_DAYS[weightChartRange] || 14;
    const rangeStart = new Date(todayDate); rangeStart.setDate(rangeStart.getDate() - rangeDays);
    const filtered = data.filter(d => {
        const t = msFor(d.date);
        return t >= rangeStart.getTime() && t <= todayDate.getTime();
    });

    // Percentage change: newest vs oldest actual entry within the range
    const changeEl = document.getElementById('weightChange')!;
    if (changeEl) {
        if (filtered.length === 0) {
            changeEl.textContent = 'N/A';
            changeEl.classList.remove('change-up', 'change-down');
        } else {
            const oldest = filtered[0].weight_kg;
            const newest = filtered[filtered.length - 1].weight_kg;
            const pct = oldest ? ((newest - oldest) / oldest) * 100 : 0;
            const sign = pct > 0 ? '+' : '';
            changeEl.textContent = `${sign}${pct.toFixed(2)}%`;
            changeEl.classList.toggle('change-up', pct > 0);    // weight gain → red
            changeEl.classList.toggle('change-down', pct < 0);  // weight loss → green
        }
    }

    // Interval line spans the average window (last 7 days) within the filtered data
    const avgStart = new Date(todayDate); avgStart.setDate(avgStart.getDate() - 7);
    let startIndex: any = null, endIndex: any = null;
    filtered.forEach((d, i) => {
        const t = msFor(d.date);
        if (t >= avgStart.getTime() && t <= todayDate.getTime()) {
            if (startIndex === null) startIndex = i;
            endIndex = i;
        }
    });

    if (weightChartInstance) { weightChartInstance.destroy(); weightChartInstance = null; }
    if (filtered.length === 0) return;

    const isLight = document.documentElement.classList.contains('light-mode');
    const gridColor = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)';
    const tickColor = isLight ? '#6b7280' : '#8b92b0';

    const pRgb = cssVar('--color-primary-rgb');
    const pColor = cssVar('--color-primary');
    const rangeColor = pColor;

    const weightTarget = healthMetricsCache.weight_target || 0;
    const datasets: any[] = [{
        label: 'Weight (kg)',
        data: filtered.map(d => d.weight_kg),
        borderColor: pColor,
        backgroundColor: `rgba(${pRgb}, 0.1)`,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: pColor,
        fill: true
    }];
    if (weightTarget > 0) {
        datasets.push({
            label: `Target (${weightTarget} kg)`,
            data: filtered.map(() => weightTarget),
            borderColor: '#34d399',
            borderDash: [6, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false
        });
    }

    const ctx = canvas.getContext('2d');
    weightChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: filtered.map(d => { const [y, m, dd] = d.date.split('-'); return `${dd}/${m}/${y}`; }), datasets },
        options: {
            responsive: true,
            layout: { padding: { bottom: 22 } },
            plugins: {
                legend: { display: weightTarget > 0, labels: { color: tickColor, boxWidth: 12 } },
                averageRange: { startIndex, endIndex, color: rangeColor }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: gridColor },
                    ticks: { color: tickColor },
                    title: { display: true, text: 'Weight (kg)', color: tickColor }
                },
                x: {
                    grid: { color: gridColor },
                    ticks: { color: tickColor },
                    title: { display: true, text: 'Date', color: tickColor }
                }
            }
        }
    });
}

// Wire up the time-range buttons (1W | 2W | 1M | 5M | 1Y)
function setupWeightRangeButtons() {
    const buttons = document.querySelectorAll('.weight-range-buttons button');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            weightChartRange = btn.dataset.range!;
            buttons.forEach(b => b.classList.toggle('active', b === btn));
            renderWeightChart();
        });
    });
}

async function saveWeightEntry() {
    const date = document.getElementById('weightDate')!.value;
    const weight = parseFloat(document.getElementById('weightKg')!.value);
    if (!date || !weight) return;
    try {
        await fetch('/api/weight-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, weight_kg: weight })
        });
        document.getElementById('weightKg')!.value = '';
        loadWeightLog();
    } catch (e) {
        console.error('Error saving weight:', e);
    }
}

// ── XP System ──────────────────────────────────────────────────

async function loadXP() {
    try {
        const res = await fetch('/api/xp');
        const data = await res.json();
        const el = document.getElementById('xp-display')!;
        let text = `Lv.${data.level} · ${data.total_xp.toLocaleString()} XP`;
        if (data.multiplier > 1) text += ` ×${data.multiplier.toFixed(2)}`;
        el.textContent = text;
        const pct = Math.min(100, data.xp_for_next > 0 ? (data.xp_in_level / data.xp_for_next) * 100 : 100);
        document.getElementById('xp-progress-fill')!.style.width = pct + '%';
        document.getElementById('xp-progress-label')!.textContent =
            `${data.xp_in_level.toLocaleString()} / ${data.xp_for_next.toLocaleString()} XP to next level`;
    } catch (e) {
        console.error('Error loading XP:', e);
    }
}

async function loadXPLog() {
    try {
        const res = await fetch('/api/xp/log');
        const entries = await res.json();
        const list = document.getElementById('xp-log-list')!;
        if (entries.length === 0) {
            list.innerHTML = '<p style="color:#8b92b0;text-align:center;padding:20px;">No XP events yet.</p>';
            return;
        }
        list.innerHTML = entries.map(e => {
            const sign = e.change >= 0 ? '+' : '';
            const cls = e.change >= 0 ? 'xp-positive' : 'xp-negative';
            return `<div class="xp-entry">
                <span class="xp-entry-date">${e.date}</span>
                <span class="xp-entry-reason">${e.reason}</span>
                <span class="xp-entry-change ${cls}">${sign}${e.change} XP</span>
            </div>`;
        }).join('');
    } catch (e) {
        console.error('Error loading XP log:', e);
    }
}

async function checkCompleteDay() {
    try {
        await fetch('/api/xp/complete-day', { method: 'POST' });
        loadXP();
        loadXPLog();
    } catch (e) {
        console.error('Error checking complete day:', e);
    }
}

async function initializeApp() {
    await loadCategories();
    await loadActivitiesFromDatabase();
    await loadCalendarEvents();
    await renderCalendar();
    loadEventsForSelectedDate();
    loadDailySummary();
    loadPillarScores();
    loadWins();
    loadWeekChart();
    setupTaskForms();
    loadAllTasks().then(() => populateConditionsGoalSelect());
    loadRecipes();
    loadPeriods();
    loadYume();
    document.getElementById('currentDate')!.value = getLocalDateString();
    loadDailyGoals(getLocalDateString());
    loadFinance();
    setupReminderForms();
    loadAllReminders();
    checkReminderAlerts();
    setInterval(checkReminderAlerts, 60000);
    document.getElementById('weightDate')!.value = getLocalDateString();
    setupWeightRangeButtons();
    loadWeightLog();
    document.getElementById('healthDate')!.value = getLocalDateString();
    await loadHealthMetrics();
    loadFoodLog(getLocalDateString());
    renderActivityOptions();
    setupActivityMenu();
    loadActivityLog(getLocalDateString());
    loadWater(getLocalDateString());
    loadNutritionWeekChart();
    loadRecentFoods();
    // XP system
    fetch('/api/xp/daily-check', { method: 'POST' }).then(() => {
        loadXP();
        loadXPLog();
    });
}

initializeApp();

