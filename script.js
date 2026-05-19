"use strict";

// ============================================================
// パスワード設定
// ここを変更するとパスワードが変わります（6桁の数字）
// ============================================================
const PASSWORD = "123456";

// ============================================================
// localStorage のキー名
// ============================================================
const KEY_AUTH = "juggler_auth";  // ログイン状態の保存先
const KEY_DATA = "juggler_data";  // 入力データの保存先

// ============================================================
// アプリの状態（グローバル変数）
// ============================================================
let rows  = [];  // 入力行データの配列
let nextId = 1;  // 次に追加する行のID（重複しないように）

// フィールドの順番（「.」ナビゲーションで使用）
const FIELDS = ["unit", "normalg", "prob", "bb", "rb"];

// ============================================================
// ページ読み込み完了後に実行
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  // ログイン済みか確認し、画面を切り替える
  if (localStorage.getItem(KEY_AUTH) === "true") {
    showMain();
  } else {
    showLogin();
  }

  // ボタンのイベントを登録
  document.getElementById("btn-login") .addEventListener("click", doLogin);
  document.getElementById("btn-logout").addEventListener("click", doLogout);
  document.getElementById("btn-add")   .addEventListener("click", doAddRow);
  document.getElementById("btn-clear") .addEventListener("click", doClearAll);

  // パスワード入力欄でEnterキーを押してもログインできるようにする
  document.getElementById("pw-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
});

// ============================================================
// 画面の切り替え
// ============================================================

// ログイン画面を表示する
function showLogin() {
  document.getElementById("screen-login").style.display = "flex";
  document.getElementById("screen-main").style.display  = "none";
  // 少し待ってからフォーカス（スマホでキーボードが開くようにする）
  setTimeout(() => document.getElementById("pw-input").focus(), 100);
}

// メイン画面を表示する
function showMain() {
  document.getElementById("screen-login").style.display = "none";
  document.getElementById("screen-main").style.display  = "flex";
  loadData();     // 保存データを読み込む
  renderTable();  // テーブルを描画する
  calcSummary();  // 集計結果を更新する
}

// ============================================================
// ログイン・ログアウト処理
// ============================================================

// 「ログイン」ボタンを押したとき
function doLogin() {
  const input  = document.getElementById("pw-input");
  const errMsg = document.getElementById("pw-error");

  if (input.value === PASSWORD) {
    // 正解：ログイン状態をlocalStorageに保存してメイン画面へ
    localStorage.setItem(KEY_AUTH, "true");
    errMsg.textContent = "";
    showMain();
  } else {
    // 不正解：エラーを表示して入力欄をクリア
    errMsg.textContent = "パスワードが違います";
    input.value = "";
    input.focus();
  }
}

// 「ログアウト」ボタンを押したとき
function doLogout() {
  localStorage.removeItem(KEY_AUTH);
  document.getElementById("pw-input").value = "";
  document.getElementById("pw-error").textContent = "";
  showLogin();
}

// ============================================================
// データの保存・読み込み（localStorage）
// ============================================================

// 保存されたデータを読み込む
function loadData() {
  try {
    const raw = localStorage.getItem(KEY_DATA);
    if (raw) {
      const obj = JSON.parse(raw);
      rows   = obj.rows   || [];
      nextId = obj.nextId || 1;

      // IDが重複しないよう、保存済みIDの最大値+1 に補正する
      if (rows.length > 0) {
        const maxId = Math.max(...rows.map((r) => r.id));
        if (nextId <= maxId) nextId = maxId + 1;
      }
    }
  } catch (e) {
    // 読み込みエラーの場合は初期化
    console.error("データ読み込みエラー:", e);
    rows   = [];
    nextId = 1;
  }

  // 行がひとつもない場合は空行を1行追加する
  if (rows.length === 0) addRow();
}

// 現在のデータをlocalStorageに保存する
function saveData() {
  try {
    localStorage.setItem(KEY_DATA, JSON.stringify({ rows, nextId }));
  } catch (e) {
    console.error("データ保存エラー:", e);
  }
}

// ============================================================
// 行データの操作
// ============================================================

// 新しい行を配列に追加して返す（テーブルの描画はしない）
function addRow() {
  const row = {
    id:      nextId++, // ユニークなID
    unit:    "",       // 台番号
    normalg: "",       // 通常G（直接入力）
    prob:    "",       // 合成確率の分母（例：120 → 1/120）
    bb:      "",       // BB回数
    rb:      "",       // RB回数
  };
  rows.push(row);
  return row;
}

// 「行追加」ボタンを押したとき
function doAddRow() {
  const row = addRow();
  renderTable();
  saveData();
  calcSummary();
  // 新しい行の台番号欄にフォーカス
  requestAnimationFrame(() => focusField(row.id, "unit"));
}

// 指定IDの行を削除する
function removeRow(id) {
  rows = rows.filter((r) => r.id !== id);
  // 全行削除された場合は空行を1行追加する
  if (rows.length === 0) addRow();
  renderTable();
  saveData();
  calcSummary();
}

// 「全削除」ボタンを押したとき
function doClearAll() {
  if (!confirm("全てのデータを削除しますか？")) return;
  rows   = [];
  nextId = 1;
  addRow(); // 空行を1行追加
  renderTable();
  saveData();
  calcSummary();
}

// ============================================================
// 計算ロジック
// ============================================================

// 有効な通常G値を取得する
// 戻り値: { value: 数値, auto: true/false } または null
//   auto: true  → 合成確率から自動計算
//   auto: false → 直接入力された値
function getEffectiveG(row) {
  // 優先①：通常G欄に直接入力されている場合
  if (row.normalg !== "") {
    const v = parseFloat(row.normalg);
    if (!isNaN(v) && v > 0) return { value: v, auto: false };
  }

  // 優先②：合成確率の分母と (BB+RB) から逆算
  // 計算式: 通常G = 合成確率の分母 × (BB回数 + RB回数)
  if (row.prob !== "") {
    const p  = parseFloat(row.prob);
    const bb = parseInt(row.bb, 10) || 0;
    const rb = parseInt(row.rb, 10) || 0;
    if (!isNaN(p) && p > 0 && (bb + rb) > 0) {
      return { value: p * (bb + rb), auto: true };
    }
  }

  return null; // 計算できない
}

// 全行の合計を計算して集計エリアを更新する
function calcSummary() {
  let sumG  = 0;   // 通常G合計
  let sumBB = 0;   // BB合計
  let sumRB = 0;   // RB合計
  let hasG  = false; // 有効な通常Gがあるか

  rows.forEach((row) => {
    const g = getEffectiveG(row);
    if (g) { sumG += g.value; hasG = true; }
    sumBB += parseInt(row.bb, 10) || 0;
    sumRB += parseInt(row.rb, 10) || 0;
  });

  // 確率表示用のフォーマット（小数1桁）
  const fmt = (n) => `1/${n.toFixed(1)}`;

  // 通常G合計
  setVal("sum-g",  hasG ? `${Math.round(sumG).toLocaleString()}G` : "-");
  // BB・RB合計
  setVal("sum-bb", sumBB > 0 ? `${sumBB}回` : "-");
  setVal("sum-rb", sumRB > 0 ? `${sumRB}回` : "-");

  // BB確率 = 通常G合計 ÷ BB合計（BB=0のとき「-」）
  setVal("prob-bb",  hasG && sumBB > 0 ? fmt(sumG / sumBB)  : "-");
  // RB確率 = 通常G合計 ÷ RB合計（RB=0のとき「-」）
  setVal("prob-rb",  hasG && sumRB > 0 ? fmt(sumG / sumRB)  : "-");
  // 合算確率 = 通常G合計 ÷ (BB+RB) 合計
  setVal("prob-all", hasG && (sumBB + sumRB) > 0 ? fmt(sumG / (sumBB + sumRB)) : "-");
}

// 指定IDの要素のテキストを更新するヘルパー
function setVal(id, text) {
  document.getElementById(id).textContent = text;
}

// ============================================================
// テーブルの描画
// ============================================================

function renderTable() {
  const tbody = document.getElementById("tbl-body");
  tbody.innerHTML = ""; // 既存の行をすべて削除

  rows.forEach((row) => {
    // 自動計算した通常Gの値（直接入力がない場合のプレースホルダー用）
    const g     = getEffectiveG(row);
    const autoG = (row.normalg === "" && g !== null) ? Math.round(g.value) : null;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <input class="f f-unit" type="text" inputmode="decimal"
          value="${esc(row.unit)}" placeholder="台番"
          data-f="unit" data-id="${row.id}">
      </td>
      <td>
        <!-- 直接入力が空で自動計算できる場合、プレースホルダーに値を表示（f-autoクラスで青く表示） -->
        <input class="f f-g${autoG !== null ? " f-auto" : ""}" type="text" inputmode="decimal"
          value="${esc(row.normalg)}"
          placeholder="${autoG !== null ? autoG + "G 自動" : "G数"}"
          data-f="normalg" data-id="${row.id}">
      </td>
      <td>
        <!-- 合成確率の分母を入力（例：120 → 1/120 として扱う） -->
        <input class="f f-prob" type="text" inputmode="decimal"
          value="${esc(row.prob)}" placeholder="分母"
          data-f="prob" data-id="${row.id}">
      </td>
      <td>
        <input class="f f-bb" type="text" inputmode="decimal"
          value="${esc(row.bb)}" placeholder="0"
          data-f="bb" data-id="${row.id}">
      </td>
      <td>
        <input class="f f-rb" type="text" inputmode="decimal"
          value="${esc(row.rb)}" placeholder="0"
          data-f="rb" data-id="${row.id}">
      </td>
      <td>
        <button class="btn-del" data-id="${row.id}" aria-label="この行を削除">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 描画後にイベントリスナーを設定する
  setupTableEvents();
}

// HTML特殊文字をエスケープ（XSS対策）
function esc(s) {
  return String(s)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

// ============================================================
// テーブル内の入力イベント設定
// ============================================================

function setupTableEvents() {
  // 全入力欄にイベントを設定
  document.querySelectorAll("#tbl-body .f").forEach((inp) => {
    inp.addEventListener("input", onInput);
    inp.addEventListener("blur",  onBlur);
    inp.addEventListener("focus", onFocus);
  });

  // 各行の削除ボタン
  document.querySelectorAll("#tbl-body .btn-del").forEach((btn) => {
    btn.addEventListener("click", () => removeRow(parseInt(btn.dataset.id, 10)));
  });
}

// フォーカスしたとき：内容を全選択（上書き入力しやすいように）
function onFocus(e) {
  e.target.select();
}

// 値が変化したとき（メインの処理）
function onInput(e) {
  const inp   = e.target;
  const field = inp.dataset.f;
  const id    = parseInt(inp.dataset.id, 10);

  // ===「.」が入力されたらナビゲーション===
  if (inp.value.includes(".")) {
    // 「.」を除去（入力値に残さない）
    inp.value = inp.value.replace(/\./g, "");
    // データを更新
    setField(id, field, inp.value);
    // 通常Gの自動計算プレースホルダーを更新
    refreshAutoG(id);
    calcSummary();
    saveData();
    // 次のフィールドへ移動
    navigateNext(id, field);
    return;
  }

  // === 通常の入力 ===
  setField(id, field, inp.value);
  refreshAutoG(id);
  calcSummary();
  saveData();
}

// フォーカスが外れたとき：最終確認として保存
function onBlur(e) {
  const inp = e.target;
  setField(parseInt(inp.dataset.id, 10), inp.dataset.f, inp.value);
  calcSummary();
  saveData();
}

// 行データの特定フィールドを更新するヘルパー
function setField(id, field, val) {
  const row = rows.find((r) => r.id === id);
  if (row) row[field] = val;
}

// 通常G欄のプレースホルダーと自動クラスを更新する
// （合成・BB・RBが変わったときに呼ぶ）
function refreshAutoG(id) {
  const row = rows.find((r) => r.id === id);
  if (!row) return;

  // 通常G入力欄を取得
  const inp = document.querySelector(`.f-g[data-id="${id}"]`);
  if (!inp) return;

  const g = getEffectiveG(row);

  if (row.normalg === "" && g !== null) {
    // 自動計算できる場合：プレースホルダーに計算値を表示（青文字）
    inp.placeholder = `${Math.round(g.value)}G 自動`;
    inp.classList.add("f-auto");
  } else {
    // 自動計算できない、または直接入力がある場合
    inp.placeholder = "G数";
    inp.classList.remove("f-auto");
  }
}

// ============================================================
// フィールドナビゲーション（「.」で次の入力欄へ移動）
// ============================================================

// 入力順：台番 → 通常G → 合成 → BB → RB → 次の行の台番 …
function navigateNext(id, field) {
  const idx = FIELDS.indexOf(field);

  if (idx < FIELDS.length - 1) {
    // 同じ行の次のフィールドへ移動
    focusField(id, FIELDS[idx + 1]);
  } else {
    // RB（最後のフィールド）→ 次の行の台番号へ
    const rowIdx = rows.findIndex((r) => r.id === id);

    if (rowIdx < rows.length - 1) {
      // 次の行が存在する
      focusField(rows[rowIdx + 1].id, "unit");
    } else {
      // 最後の行だった → 新しい行を追加してそこへ移動
      const newRow = addRow();
      renderTable();
      saveData();
      calcSummary();
      // renderTable()後にDOMが更新されるので requestAnimationFrame で待つ
      requestAnimationFrame(() => focusField(newRow.id, "unit"));
    }
  }
}

// 指定した行・フィールドの入力欄にフォーカスする
function focusField(id, field) {
  const inp = document.querySelector(`[data-f="${field}"][data-id="${id}"]`);
  if (inp) {
    inp.focus();
    inp.select();
  }
}
