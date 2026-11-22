const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const goalsEl = document.getElementById("goals");
const shotsEl = document.getElementById("shots");
const bannerEl = document.getElementById("banner");

let width, height;
let goals = 0;
let shots = 0;

const STATE = {
  AIMING: "aiming",
  SHOOTING: "shooting",
  RESULT: "result"
};
let gameState = STATE.AIMING;

// المرمى أبعد وأصغر قليلاً لإعطاء مسافة ركلة حرة حقيقية (25 - 30 ياردة)
const goal = {
  x: 0,
  y: 72,
  width: 260,
  height: 92
};

// الكرة مع بيانات المسار المنحني الفعلي (حرف C / قوس)
const ball = {
  startX: 0,
  startY: 0,
  targetX: 0,
  targetY: 0,
  x: 0,
  y: 0,
  t: 0, // نسبة التقدم من 0 (عند اللاعب) إلى 1 (عند خط المرمى)
  speed: 0.016,
  curveBend: 0, // مقدار انحناء القوس بالبكسل (يميناً أو يساراً)
  arcHeight: 150, // أقصى ارتفاع تصل إليه الكرة في منتصف الطريق
  radius: 17,
  spinAngle: 0,
  trail: []
};

const keeper = {
  x: 0,
  y: 0,
  width: 38,
  height: 70,
  targetX: 0,
  diveOffset: 0,
  diveDir: 0
};

const wall = {
  players: [],
  t: 0.45, // موقع الحائط في منتصف المسافة تقريباً
  jumpOffset: 0,
  jumping: false
};

let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragCurrent = { x: 0, y: 0 };
let dragPoints = [];

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  width = canvas.width;
  height = canvas.height;

  // ضبط أبعاد المرمى البعيد
  goal.width = Math.min(270, width * 0.38);
  goal.height = Math.round(goal.width * 0.35);
  goal.x = (width - goal.width) / 2;

  if (gameState === STATE.AIMING) resetRound();
}

window.addEventListener("resize", resize);

function resetRound() {
  gameState = STATE.AIMING;
  bannerEl.classList.add("hidden");

  // وضع الكرة في أقصى أسفل الملعب لزيادة المسافة بين الكرة والمرمى
  const startX = width / 2 + (Math.random() - 0.5) * (width * 0.32);
  ball.startX = startX;
  ball.startY = height - 52;
  ball.x = ball.startX;
  ball.y = ball.startY;
  ball.t = 0;
  ball.curveBend = 0;
  ball.trail = [];

  keeper.x = goal.x + goal.width / 2;
  keeper.y = goal.y + goal.height - 10;
  keeper.targetX = keeper.x;
  keeper.diveOffset = 0;
  keeper.diveDir = 0;

  setupWall();
}

function setupWall() {
  wall.players = [];
  wall.jumpOffset = 0;
  wall.jumping = false;

  const goalCenter = goal.x + goal.width / 2;
  // وضع حائط الصد على الخط المستقيم بين الكرة والمرمى لإجبار اللاعب على لفّ الكرة حوله
  const wallBaseX = ball.startX + (goalCenter - ball.startX) * wall.t;
  const count = 4;
  const spacing = 25;
  const startWallX = wallBaseX - ((count - 1) * spacing) / 2;

  for (let i = 0; i < count; i++) {
    wall.players.push({
      x: startWallX + i * spacing
    });
  }
}

function showBanner(text, color = "#ffd700") {
  bannerEl.textContent = text;
  bannerEl.style.color = color;
  bannerEl.style.borderColor = color;
  bannerEl.classList.remove("hidden");
}

function getPointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

// حساب انحناء السحب (كيف رسم اللاعب الحرف / القوس بإصبعه أو الماوس)
function calculateDragGesture() {
  const dx = dragCurrent.x - dragStart.x;
  const dy = dragCurrent.y - dragStart.y;
  const pullDist = Math.hypot(dx, dy);

  const isSlingshot = dy > 15;
  const aimX = isSlingshot ? -dx : dx;
  const aimY = isSlingshot ? -dy : dy;

  // قياس أقصى انحراف جانبي رسمه اللاعب أثناء السحب لتحديد شكل القوس (حرف C)
  let maxDeviation = 0;
  if (dragPoints.length > 2) {
    const p1 = dragPoints[0];
    const p2 = dragPoints[dragPoints.length - 1];
    const lineLen = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;

    for (let pt of dragPoints) {
      // المسافة العمودية الموجهة بين نقطة السحب والخط المستقيم بين البداية والنهاية
      const signedDist =
        ((p2.y - p1.y) * (pt.x - p1.x) - (p2.x - p1.x) * (pt.y - p1.y)) / lineLen;
      if (Math.abs(signedDist) > Math.abs(maxDeviation)) {
        maxDeviation = signedDist;
      }
    }
  }

  // تضخيم الانحناء ليلف بوضوح حول الحائط
  const curveBend = Math.max(-240, Math.min(240, maxDeviation * 2.4));

  // تحديد نقطة النهاية عند خط المرمى بناءً على اتجاه السحب
  const targetX = ball.startX + aimX * 1.45;
  // تحديد الارتفاع عند المرمى + أقصى ارتفاع للقوس في الجو
  const powerRatio = Math.min(pullDist, 240) / 240;
  const targetY = goal.y + goal.height - 15 + (aimY + 130) * 0.45;
  const arcHeight = 110 + powerRatio * 115;

  return { pullDist, aimY, targetX, targetY, curveBend, arcHeight, powerRatio };
}

// معادلة موقع الكرة في أي لحظة t (من 0 إلى 1) بحيث ترسم قوساً حقيقياً (حرف C)
function getBallPositionAt(t, startX, startY, targetX, targetY, curveBend, arcHeight) {
  // الخط الأساسي من نقطة البداية إلى نقطة الهدف
  const baseX = startX + (targetX - startX) * t;
  const baseY = startY + (targetY - startY) * t;

  // معادلة القوس القطعي 4 * t * (1 - t):
  // تساوي 0 عند البداية (t=0)، وتبلغ ذروتها (1) في منتصف الطريق (t=0.5)، وتعود إلى 0 عند المرمى (t=1)
  const arch = 4 * t * (1 - t);

  const x = baseX + curveBend * arch;
  const y = baseY - arcHeight * arch;

  return { x, y };
}

canvas.addEventListener("pointerdown", (e) => {
  if (gameState !== STATE.AIMING) return;
  const pos = getPointerPos(e);
  const dist = Math.hypot(pos.x - ball.x, pos.y - ball.y);
  if (dist < 80) {
    isDragging = true;
    dragStart = { x: ball.x, y: ball.y };
    dragCurrent = pos;
    dragPoints = [pos];
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!isDragging) return;
  dragCurrent = getPointerPos(e);
  dragPoints.push(dragCurrent);
});

canvas.addEventListener("pointerup", () => {
  if (!isDragging) return;
  isDragging = false;
  shootBall();
});

function shootBall() {
  const gesture = calculateDragGesture();
  if (gesture.pullDist < 22 || gesture.aimY > -15) return;

  shots++;
  shotsEl.textContent = shots;
  gameState = STATE.SHOOTING;

  ball.t = 0;
  ball.targetX = gesture.targetX;
  ball.targetY = gesture.targetY;
  ball.curveBend = gesture.curveBend;
  ball.arcHeight = gesture.arcHeight;
  // سرعة متناسبة مع المسافة البعيدة للمرمى
  ball.speed = 0.0135 + gesture.powerRatio * 0.0075;

  setTimeout(() => {
    if (gameState === STATE.SHOOTING) wall.jumping = true;
  }, 180);

  // توقع الحارس لمكان وصول الكرة النهائي
  const reactionError = (Math.random() - 0.5) * 85;
  keeper.targetX = Math.max(
    goal.x + 20,
    Math.min(goal.x + goal.width - 20, ball.targetX + reactionError)
  );
  keeper.diveDir = keeper.targetX > keeper.x ? 1 : -1;
}

function update() {
  if (gameState === STATE.SHOOTING) {
    ball.trail.push({ x: ball.x, y: ball.y, t: ball.t });
    if (ball.trail.length > 18) ball.trail.shift();

    ball.t += ball.speed;
    const pos = getBallPositionAt(
      ball.t,
      ball.startX,
      ball.startY,
      ball.targetX,
      ball.targetY,
      ball.curveBend,
      ball.arcHeight
    );
    ball.x = pos.x;
    ball.y = pos.y;
    ball.spinAngle += (ball.curveBend * 0.0025) + 0.15;

    if (wall.jumping && wall.jumpOffset < 24) {
      wall.jumpOffset += 2;
    }

    // حركة الحارس
    keeper.x += (keeper.targetX - keeper.x) * 0.075;
    if (Math.abs(keeper.targetX - keeper.x) > 8) {
      keeper.diveOffset = Math.min(22, keeper.diveOffset + 1.4);
    }

    // التحقق من الاصطدام بحائط الصد عند wall.t
    if (Math.abs(ball.t - wall.t) < 0.022) {
      const groundY = getGroundY(wall.t);
      const wallTopY = groundY - 56 - wall.jumpOffset;

      for (let p of wall.players) {
        if (
          Math.abs(ball.x - p.x) < 17 &&
          ball.y > wallTopY &&
          ball.y < groundY
        ) {
          finishShot("اصطدمت بالحائط!", "#f87171");
          return;
        }
      }
    }

    // التحقق من الوصول لخط المرمى عند t >= 1
    if (ball.t >= 1) {
      checkGoalOrSave();
    }
  }
}

function checkGoalOrSave() {
  const inGoalX = ball.x > goal.x + 6 && ball.x < goal.x + goal.width - 6;
  const inGoalY = ball.y > goal.y + 4 && ball.y < goal.y + goal.height + 8;

  const keeperReachX = 30 + keeper.diveOffset * 0.55;
  const keeperTopY = keeper.y - keeper.height;
  const savedByKeeper =
    Math.abs(ball.x - keeper.x) < keeperReachX &&
    ball.y > keeperTopY - 8 &&
    ball.y < keeper.y + 8;

  if (savedByKeeper && inGoalX && inGoalY) {
    finishShot("تصدّى لها الحارس!", "#fb923c");
  } else if (inGoalX && inGoalY) {
    goals++;
    goalsEl.textContent = goals;
    finishShot("GOOOAL! لفّة عالمية!", "#4ade80");
  } else {
    finishShot("خارج المرمى!", "#94a3b8");
  }
}

function finishShot(message, color) {
  gameState = STATE.RESULT;
  showBanner(message, color);
  setTimeout(resetRound, 1750);
}

function getGroundY(t) {
  const startY = height - 52;
  const endY = goal.y + goal.height;
  return startY + (endY - startY) * t;
}

function drawField() {
  const fieldTop = goal.y + goal.height;

  // المدرجات والسماء
  const skyGrad = ctx.createLinearGradient(0, 0, 0, fieldTop);
  skyGrad.addColorStop(0, "#090f24");
  skyGrad.addColorStop(1, "#18223d");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, fieldTop);

  // كشافات الملعب
  ctx.fillStyle = "rgba(255, 255, 220, 0.12)";
  ctx.beginPath();
  ctx.arc(80, 38, 45, 0, Math.PI * 2);
  ctx.arc(width - 80, 38, 45, 0, Math.PI * 2);
  ctx.fill();

  // أرضية الملعب (10 شرائح لإظهار طول المسافة)
  const stripes = 10;
  const stripeH = (height - fieldTop) / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#1e7e34" : "#238b3a";
    ctx.fillRect(0, fieldTop + i * stripeH, width, stripeH + 1);
  }

  // منطقة الجزاء ومنطقة الـ 6 ياردات (بحجم متناسب مع بعد المرمى)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(goal.x - 80, fieldTop, goal.width + 160, 95);
  ctx.strokeRect(goal.x - 28, fieldTop, goal.width + 56, 40);

  // قوس منطقة الجزاء
  ctx.beginPath();
  ctx.arc(width / 2, fieldTop + 95, 52, 0, Math.PI);
  ctx.stroke();
}

function drawGoal() {
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.fillRect(goal.x, goal.y, goal.width, goal.height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  for (let x = goal.x; x <= goal.x + goal.width; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, goal.y);
    ctx.lineTo(x, goal.y + goal.height);
    ctx.stroke();
  }
  for (let y = goal.y; y <= goal.y + goal.height; y += 14) {
    ctx.beginPath();
    ctx.moveTo(goal.x, y);
    ctx.lineTo(goal.x + goal.width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(goal.x, goal.y + goal.height);
  ctx.lineTo(goal.x, goal.y);
  ctx.lineTo(goal.x + goal.width, goal.y);
  ctx.lineTo(goal.x + goal.width, goal.y + goal.height);
  ctx.stroke();
}

function drawKeeper() {
  const kx = keeper.x;
  const ky = keeper.y;
  const tilt = keeper.diveDir * (keeper.diveOffset * 0.025);

  ctx.save();
  ctx.translate(kx, ky - 28);
  ctx.rotate(tilt);

  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(-11, -18, 22, 31);

  ctx.fillStyle = "#111827";
  ctx.fillRect(-10, 13, 20, 13);

  ctx.fillStyle = "#fcd34d";
  ctx.beginPath();
  ctx.arc(0, -26, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-11, -11);
  ctx.lineTo(-26, -21 - keeper.diveOffset * 0.25);
  ctx.moveTo(11, -11);
  ctx.lineTo(26, -21 - keeper.diveOffset * 0.25);
  ctx.stroke();

  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(-28, -22 - keeper.diveOffset * 0.25, 5, 0, Math.PI * 2);
  ctx.arc(28, -22 - keeper.diveOffset * 0.25, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawWall() {
  const groundY = getGroundY(wall.t);
  const baseY = groundY - wall.jumpOffset;

  wall.players.forEach((p) => {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(p.x, groundY + 3, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#dc2626";
    ctx.fillRect(p.x - 9, baseY - 44, 18, 27);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(p.x - 8, baseY - 17, 16, 11);

    ctx.fillStyle = "#f5d0a9";
    ctx.fillRect(p.x - 6, baseY - 6, 5, 8);
    ctx.fillRect(p.x + 1, baseY - 6, 5, 8);

    ctx.fillStyle = "#f5d0a9";
    ctx.beginPath();
    ctx.arc(p.x, baseY - 51, 7.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawAimGuide() {
  if (!isDragging) return;

  const gesture = calculateDragGesture();
  if (gesture.pullDist < 15) return;

  // رسم المسار الكامل من الكرة إلى المرمى بنفس معادلة القوس (حرف C)
  ctx.save();
  const steps = 22;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const pt = getBallPositionAt(
      t,
      ball.startX,
      ball.startY,
      gesture.targetX,
      gesture.targetY,
      gesture.curveBend,
      gesture.arcHeight
    );

    const dotRadius = Math.max(2.5, (1 - t * 0.5) * 6);
    ctx.fillStyle = `rgba(255, 215, 0, ${0.95 - t * 0.55})`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBall() {
  ball.trail.forEach((tr, idx) => {
    const scale = 1 - tr.t * 0.55;
    ctx.fillStyle = `rgba(255, 255, 255, ${(idx / ball.trail.length) * 0.28})`;
    ctx.beginPath();
    ctx.arc(tr.x, tr.y, ball.radius * scale * 0.85, 0, Math.PI * 2);
    ctx.fill();
  });

  // تصغير تدريجي للكرة مع الابتعاد نحو المرمى البعيد
  const scale = Math.max(0.42, 1 - ball.t * 0.55);
  const r = ball.radius * scale;

  // ظل الكرة على العشب أسفل موقعها الفعلي لإظهار مدى ارتفاعها في الهواء
  const groundY = getGroundY(ball.t);
  const heightAboveGround = Math.max(0, groundY - ball.y);
  const shadowScale = Math.max(0.4, 1 - heightAboveGround / 280);

  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  ctx.beginPath();
  ctx.ellipse(
    ball.x,
    groundY + 4,
    r * 1.15 * shadowScale,
    r * 0.4 * shadowScale,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // رسم الكرة
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(ball.spinAngle);

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "#111827";
  ctx.stroke();

  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * r * 0.72, Math.sin(angle) * r * 0.72, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function loop() {
  update();

  ctx.clearRect(0, 0, width, height);
  drawField();
  drawGoal();
  drawKeeper();

  if (ball.t < wall.t) {
    drawWall();
    drawAimGuide();
    drawBall();
  } else {
    drawBall();
    drawWall();
  }

  requestAnimationFrame(loop);
}

resize();
loop();
    
