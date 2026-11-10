const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outDir = 'C:/Users/Ingenieria Software/.gemini/antigravity/brain/9be26797-e597-4eee-959f-c35ccb6a83f3';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function buildHtml(isDark, scrollMode = 'normal') {
  const bgBody = isDark ? '#0d0d0f' : '#f8fafc';
  const bgCanvas = isDark ? '#09090b' : '#ffffff';
  const bgCard = isDark ? '#18181b' : '#ffffff';
  const border = isDark ? '#27272a' : '#cbd5e1';
  const borderSubtle = isDark ? '#1f1f23' : '#e2e8f0';
  const textPrimary = isDark ? '#f4f4f5' : '#0f172a';
  const textSecondary = isDark ? '#d4d4d8' : '#334155';
  const textMuted = isDark ? '#a1a1aa' : '#64748b';
  const bottomBarBg = isDark ? '#09090b' : '#FAF5EA';
  const bottomBarBorder = isDark ? '#27272a' : '#E8DCB8';

  const noContestoBg = isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2';
  const noContestoBorder = isDark ? 'rgba(239, 68, 68, 0.35)' : '#fca5a5';
  const noContestoText = isDark ? '#f87171' : '#991b1b';

  const chatCrmBg = isDark ? 'rgba(14, 165, 233, 0.15)' : '#e0f2fe';
  const chatCrmBorder = isDark ? 'rgba(14, 165, 233, 0.35)' : '#7dd3fc';
  const chatCrmText = isDark ? '#38bdf8' : '#075985';

  const llamarBg = isDark ? 'rgba(245, 158, 11, 0.15)' : '#fef3c7';
  const llamarBorder = isDark ? 'rgba(245, 158, 11, 0.35)' : '#fcd34d';
  const llamarText = isDark ? '#fbbf24' : '#92400e';

  const waBg = isDark ? 'rgba(16, 185, 129, 0.15)' : '#dcfce7';
  const waBorder = isDark ? 'rgba(16, 185, 129, 0.35)' : '#86efac';
  const waText = isDark ? '#34d399' : '#14532d';

  const hoyBg = isDark ? 'rgba(245, 158, 11, 0.12)' : '#fef3c7';
  const hoyBorder = isDark ? 'rgba(245, 158, 11, 0.30)' : '#fcd34d';
  const hoyText = isDark ? '#fcd34d' : '#92400e';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { background: ${bgBody}; color: ${textPrimary}; width: 390px; height: 844px; overflow: hidden; display: flex; flex-direction: column; }

  .status-bar { height: 28px; background: ${bgCanvas}; display: flex; justify-content: space-between; align-items: center; padding: 0 16px; font-size: 11px; font-weight: 600; color: ${textSecondary}; }

  .screen-header { background: ${bgCanvas}; border-bottom: 1px solid ${border}; padding: 10px 14px 10px; }
  .screen-title { font-size: 15px; font-weight: 800; color: ${textPrimary}; }
  .screen-sub { font-size: 10.5px; color: ${textMuted}; margin-top: 2px; }

  .top-toolbar { background: ${bgCanvas}; border-bottom: 1px solid ${border}; padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 8px; }
  .toolbar-row-1 { display: flex; gap: 8px; overflow: hidden; }
  .chip-cartera { background: ${isDark ? 'rgba(183, 135, 28, 0.15)' : '#fef3c7'}; border: 1px solid ${isDark ? 'rgba(183, 135, 28, 0.35)' : '#fcd34d'}; color: ${isDark ? '#CBA95C' : '#78350f'}; font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 8px; display: flex; align-items: center; gap: 5px; white-space: nowrap; }
  .chip-llamadas { background: ${isDark ? 'rgba(16, 185, 129, 0.15)' : '#dcfce7'}; border: 1px solid ${isDark ? 'rgba(16, 185, 129, 0.35)' : '#86efac'}; color: ${isDark ? '#34d399' : '#14532d'}; font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 8px; display: flex; align-items: center; gap: 5px; white-space: nowrap; }
  .chip-csv { background: ${isDark ? bgCard : '#ffffff'}; border: 1px solid ${border}; color: ${textSecondary}; font-size: 11px; font-weight: 600; padding: 6px 10px; border-radius: 8px; display: flex; align-items: center; gap: 5px; }

  .action-row { display: flex; gap: 8px; align-items: center; }
  .btn-refresh { width: 42px; height: 42px; border-radius: 10px; background: ${isDark ? bgCard : '#ffffff'}; border: 1px solid ${border}; display: flex; align-items: center; justify-content: center; font-size: 16px; color: ${textSecondary}; }
  .btn-new-lead { flex: 1; height: 42px; border-radius: 10px; background: #059669; border: 1.5px solid #10b981; color: #ffffff; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 4px rgba(5,150,105,0.3); }

  .view-tabs { display: flex; background: ${isDark ? '#18181b' : '#e2e8f0'}; border: 1px solid ${border}; border-radius: 10px; padding: 3px; gap: 4px; }
  .tab-btn { flex: 1; height: 38px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
  .tab-active { background: #059669; border: 1px solid #10b981; color: #ffffff; }
  .tab-inactive { background: transparent; color: ${isDark ? '#a1a1aa' : '#475569'}; }
  .nuevo-tag-inactive { background: ${isDark ? 'rgba(245, 158, 11, 0.2)' : '#fef3c7'}; color: ${isDark ? '#fcd34d' : '#92400e'}; font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 4px; text-transform: uppercase; }

  .content { flex: 1; overflow-y: auto; padding: 10px 12px 75px; display: flex; flex-direction: column; gap: 10px; }

  .search-box { background: ${isDark ? '#18181b' : '#ffffff'}; border: 1px solid ${border}; border-radius: 10px; padding: 8px 12px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: ${textPrimary}; }
  .search-placeholder { color: ${textMuted}; }

  .filter-row-1 { display: flex; gap: 8px; }
  .dropdown { flex: 1; background: ${isDark ? '#18181b' : '#ffffff'}; border: 1px solid ${border}; border-radius: 8px; padding: 8px 10px; font-size: 11px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; color: ${textPrimary}; }
  .dropdown-full { width: 100%; background: ${isDark ? '#18181b' : '#ffffff'}; border: 1px solid ${border}; border-radius: 8px; padding: 8px 10px; font-size: 11px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; color: ${textPrimary}; }

  .count-meta { font-size: 11px; font-weight: 600; color: ${textMuted}; padding: 2px 2px; }

  .card { background: ${bgCard}; border: 1px solid ${border}; border-radius: 14px; padding: 13px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .card-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .lead-name { font-size: 15px; font-weight: 800; color: ${textPrimary}; }
  .chips-row { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
  .chip-proj { background: ${isDark ? 'rgba(183,135,28,0.15)' : '#f1f5f9'}; border: 1px solid ${isDark ? 'rgba(183,135,28,0.35)' : '#cbd5e1'}; color: ${isDark ? '#CBA95C' : '#334155'}; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px; }
  .chip-source { background: ${isDark ? '#27272a' : '#f8fafc'}; border: 1px solid ${borderSubtle}; color: ${isDark ? '#a1a1aa' : '#475569'}; font-size: 11px; padding: 2px 7px; border-radius: 6px; display: flex; align-items: center; gap: 4px; }
  .stage-pill { background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #0284c7; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; display: flex; align-items: center; gap: 5px; }

  .card-phone-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: ${textSecondary}; padding-top: 2px; }
  .phone-text { font-weight: 600; }
  .advisor-text { color: ${textMuted}; }

  .ficha-box { background: ${isDark ? '#27272a' : '#f8fafc'}; border: 1px solid ${borderSubtle}; border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; }
  .ficha-badge-row { display: flex; justify-content: space-between; align-items: center; }
  .ficha-badge { background: ${isDark ? 'rgba(16, 185, 129, 0.15)' : '#dcfce7'}; border: 1px solid ${isDark ? 'rgba(16, 185, 129, 0.35)' : '#86efac'}; color: ${isDark ? '#34d399' : '#15803d'}; font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 5px; }
  .ficha-date { font-size: 10.5px; color: ${textMuted}; }
  .ficha-snippet { font-size: 11px; color: ${textSecondary}; line-height: 15px; }
  .ficha-history-link { font-size: 11px; font-weight: 700; color: #B7871C; }

  .next-follow-box { background: ${hoyBg}; border: 1px solid ${hoyBorder}; border-radius: 10px; padding: 7px 10px; display: flex; align-items: center; gap: 8px; }
  .next-follow-title { font-size: 11.5px; font-weight: 700; color: ${hoyText}; }
  .next-follow-sub { font-size: 10px; color: ${textSecondary}; }

  .quick-strip { display: flex; gap: 6px; }
  .q-btn { flex: 1; border-radius: 10px; padding: 7px 2px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 10px; font-weight: 700; border-width: 1px; border-style: solid; text-decoration: none; }
  .q-no { background: ${noContestoBg}; border-color: ${noContestoBorder}; color: ${noContestoText}; }
  .q-chat { background: ${chatCrmBg}; border-color: ${chatCrmBorder}; color: ${chatCrmText}; }
  .q-call { background: ${llamarBg}; border-color: ${llamarBorder}; color: ${llamarText}; }
  .q-wa { background: ${waBg}; border-color: ${waBorder}; color: ${waText}; }

  /* 🌟 THE PRIMARY FULL-WIDTH GREEN BUTTON (1:1 with iPhone) 🌟 */
  .primary-green-btn {
    width: 100%;
    height: 46px;
    background: #059669;
    border: 1.5px solid #10b981;
    border-radius: 12px;
    color: #ffffff;
    font-size: 13.5px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 3px 6px rgba(5, 150, 105, 0.4);
    letter-spacing: 0.2px;
    cursor: pointer;
  }

  .bottom-nav { position: fixed; bottom: 0; left: 0; width: 390px; height: 56px; background: ${bottomBarBg}; border-top: 1px solid ${bottomBarBorder}; display: flex; justify-content: space-around; align-items: center; z-index: 50; }
  .nav-item { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 10px; font-weight: 600; color: ${textMuted}; }
  .nav-active { color: #B7871C; font-weight: 800; }
  .nav-icon { font-size: 17px; }
</style>
</head>
<body>

  <div class="status-bar">
    <span>3:21 PM</span>
    <span>5G · 85%</span>
  </div>

  <div class="screen-header">
    <div class="screen-title">Gestión Comercial & Fichas Técnicas</div>
    <div class="screen-sub">Seguimiento diario de prospectos, agenda de recordatorios y diligenciamiento de bitácoras.</div>
  </div>

  <div class="top-toolbar">
    <div class="toolbar-row-1">
      <div class="chip-cartera">👤 Mi Cartera (Pruebas)</div>
      <div class="chip-llamadas">📞 Modo Llamadas (3)</div>
      <div class="chip-csv">📥 Exportar</div>
    </div>
    <div class="action-row">
      <div class="btn-refresh">🔄</div>
      <div class="btn-new-lead">👤 + Nuevo Prospecto</div>
    </div>
    <div class="view-tabs">
      <div class="tab-btn tab-active">📋 Seguimiento & Fichas</div>
      <div class="tab-btn tab-inactive">
        🏆 Ranking & Metas
        <span class="nuevo-tag-inactive">Nuevo</span>
      </div>
    </div>
  </div>

  <div class="content" id="scrollContent">

    <div class="search-box">
      <span>🔍</span>
      <span class="search-placeholder">Buscar por nombre, celular o proyecto...</span>
    </div>

    <div class="filter-row-1">
      <div class="dropdown">
        <span>🏢 Todos los Proyectos</span>
        <span>▼</span>
      </div>
      <div class="dropdown">
        <span>📶 Todas las Etapas</span>
        <span>▼</span>
      </div>
    </div>
    <div class="dropdown-full">
      <span>⚡ Más urgentes primero</span>
      <span>▼</span>
    </div>

    <div class="count-meta">Mostrando 6 de 6 prospectos cargados</div>

    <!-- Lead Card: pepito perez -->
    <div class="card" id="targetCard">
      <div class="card-top">
        <div>
          <div class="lead-name">pepito perez</div>
          <div class="chips-row">
            <span class="chip-proj">Cañón de Arizona</span>
            <span class="chip-source">📍 Trabajo de campo</span>
          </div>
        </div>
        <div class="stage-pill">● Prospecto ▼</div>
      </div>

      <div class="card-phone-row">
        <span class="phone-text">📞 +57 544 564 8648</span>
        <span class="advisor-text">👤 Sin asignar</span>
      </div>

      <div class="ficha-box">
        <div class="ficha-badge-row">
          <span class="ficha-badge">✓ Con Ficha</span>
          <span class="ficha-date">Última: 26 de oct, 4:34 p.m.</span>
        </div>
        <div class="ficha-snippet">
          Intento de llamada de seguimiento sin respuesta por Pruebas. Reintento agendado automáticamente para hoy.
        </div>
        <div class="ficha-history-link">⌄ Ver historial (1 gestión)</div>
      </div>

      <div class="next-follow-box">
        <span style="font-size: 14px;">⏰</span>
        <div>
          <div class="next-follow-title">Para Hoy · 2026-10-26 14:34</div>
          <div class="next-follow-sub">Reintentar Llamada</div>
        </div>
      </div>

      <div class="quick-strip">
        <div class="q-btn q-no"><span>📞⃠</span><span>No contestó</span></div>
        <div class="q-btn q-chat"><span>💬</span><span>Chat CRM</span></div>
        <div class="q-btn q-call"><span>📞</span><span>Llamar</span></div>
        <div class="q-btn q-wa"><span>🟢</span><span>WhatsApp</span></div>
      </div>

      <!-- 🌟 THE GREEN BUTTON (1:1 with iPhone) 🌟 -->
      <button class="primary-green-btn">
        📄 Actualizar Ficha Técnica
      </button>
    </div>

  </div>

  <div class="bottom-nav">
    <div class="nav-item"><span class="nav-icon">💬</span><span>Bandeja</span></div>
    <div class="nav-item nav-active"><span class="nav-icon">📋</span><span>Comercial</span></div>
    <div class="nav-item"><span class="nav-icon">📊</span><span>Embudo</span></div>
    <div class="nav-item"><span class="nav-icon">📈</span><span>Resumen</span></div>
    <div class="nav-item"><span class="nav-icon">☰</span><span>Más</span></div>
  </div>

  ${scrollMode === 'scrolled' ? `
  <script>
    document.getElementById('scrollContent').scrollTop = 180;
  </script>` : ''}

</body>
</html>`;
}

// 1. Top Overview (Header, Toolbar, Tabs, Search, Card top)
const darkOverviewHtml = path.join(outDir, 'preview-dark-overview.html');
const lightOverviewHtml = path.join(outDir, 'preview-light-overview.html');
const darkOverviewPng = path.join(outDir, 'preview-dark-overview.png');
const lightOverviewPng = path.join(outDir, 'preview-light-overview.png');

fs.writeFileSync(darkOverviewHtml, buildHtml(true, 'normal'), 'utf8');
fs.writeFileSync(lightOverviewHtml, buildHtml(false, 'normal'), 'utf8');

// 2. Scrolled View (Focused on Card, Quick Buttons & The Vibrant Green Button!)
const darkCardHtml = path.join(outDir, 'preview-dark-card.html');
const lightCardHtml = path.join(outDir, 'preview-light-card.html');
const darkCardPng = path.join(outDir, 'preview-dark-card.png');
const lightCardPng = path.join(outDir, 'preview-light-card.png');

fs.writeFileSync(darkCardHtml, buildHtml(true, 'scrolled'), 'utf8');
fs.writeFileSync(lightCardHtml, buildHtml(false, 'scrolled'), 'utf8');

console.log('Capturing screenshots with Chrome...');

execSync(`"${chromePath}" --headless --disable-gpu --screenshot="${darkOverviewPng}" --window-size=390,844 "${darkOverviewHtml}"`);
execSync(`"${chromePath}" --headless --disable-gpu --screenshot="${lightOverviewPng}" --window-size=390,844 "${lightOverviewHtml}"`);
execSync(`"${chromePath}" --headless --disable-gpu --screenshot="${darkCardPng}" --window-size=390,844 "${darkCardHtml}"`);
execSync(`"${chromePath}" --headless --disable-gpu --screenshot="${lightCardPng}" --window-size=390,844 "${lightCardHtml}"`);

console.log('All 4 preview screenshots created successfully!');
