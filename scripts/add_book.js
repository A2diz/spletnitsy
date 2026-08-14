#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function nowStamp() {
  const d = new Date();
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

function backupFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const dest = path.join(dir, base + `.backup-${nowStamp()}`);
    fs.copyFileSync(filePath, dest);
    return dest;
  } catch (err) {
    console.error('Backup failed for', filePath, err);
    return null;
  }
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx+1] || null;
}

function flag(name) { return process.argv.includes(name); }

const title = getArg('--title');
const author = getArg('--author');
const year = getArg('--year') ? parseInt(getArg('--year'), 10) : null;
const date = getArg('--date'); // e.g. "Авг 2026" or "Август 2026"
const rating = getArg('--rating') ? parseFloat(getArg('--rating')) : null;
const secondaryTitle = getArg('--secondaryTitle');
const secondaryAuthor = getArg('--secondaryAuthor');
const dry = flag('--dry');

if (!title || !author) {
  console.error('Usage: node scripts/add_book.js --title "TITLE" --author "AUTHOR" [--year 2026] [--date "Авг 2026"] [--rating 8.5] [--secondaryTitle "..." --secondaryAuthor "..."] [--dry]');
  process.exit(1);
}

const repoRoot = path.join(__dirname, '..');
const indexPath = path.join(repoRoot, 'index.html');
const dataDir = path.join(repoRoot, '_data');
const currentBookPath = path.join(dataDir, 'current_book.json');

function insertIntoArrayInHtml(html, varName, itemText) {
  // Finds `const varName = [` and inserts itemText right after the opening '['
  const re = new RegExp(`const\\s+${varName}\\s*=\\s*\\[`, 'm');
  const m = html.match(re);
  if (!m) throw new Error(`${varName} not found in index.html`);
  const start = m.index + m[0].length; // position after '['
  // detect if array is empty (next non-space char is ])
  let i = start;
  while (i < html.length && /[\s\n\r]/.test(html[i])) i++;
  const isEmpty = html[i] === ']';
  const prefix = isEmpty ? '\n    ' : '\n    ';
  const newHtml = html.slice(0, start) + prefix + itemText + (isEmpty ? '\n  ' : ',') + html.slice(start);
  return newHtml;
}

try {
  const idxContent = fs.readFileSync(indexPath, 'utf8');
  const bookObj = `{ title: "${title.replace(/"/g,'\\"')}", author: "${author.replace(/"/g,'\\"')}", rating: ${rating===null?'null':rating}, year: ${year||'null'}, date: "${date||''}" }`;
  const historyObj = `{ date: "${date||''}", title: "${title.replace(/"/g,'\\"')}", author: "${author.replace(/"/g,'\\"')}", rating: ${rating===null?'null':rating} }`;

  // Backup index.html
  const b1 = backupFile(indexPath);
  if (b1) console.log('Created backup:', b1);

  let newIdx = idxContent;
  try {
    newIdx = insertIntoArrayInHtml(newIdx, 'books', bookObj);
    console.log('Inserted into books array.');
  } catch (e) {
    console.warn('Could not insert into books array:', e.message);
  }

  try {
    newIdx = insertIntoArrayInHtml(newIdx, 'historyData', historyObj);
    console.log('Inserted into historyData array.');
  } catch (e) {
    console.warn('Could not insert into historyData array:', e.message);
  }

  if (!dry) {
    fs.writeFileSync(indexPath, newIdx, 'utf8');
    console.log('index.html updated.');
  } else {
    console.log('--dry mode: index.html not written.');
  }

  // Update _data/current_book.json
  let cbBackup = null;
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    if (fs.existsSync(currentBookPath)) cbBackup = backupFile(currentBookPath);
    let currentJson = { current_books: [] };
    if (fs.existsSync(currentBookPath)) {
      try { currentJson = JSON.parse(fs.readFileSync(currentBookPath, 'utf8')); } catch (err) { console.warn('Could not parse existing current_book.json, will overwrite.'); }
    }

    // Put new book as primary
    const primary = { title: title, author: author };
    const secondary = (secondaryTitle && secondaryAuthor) ? { title: secondaryTitle, author: secondaryAuthor } : (currentJson.current_books && currentJson.current_books[1]) ? currentJson.current_books[1] : null;
    currentJson.current_books = [primary].concat(secondary ? [secondary] : []);

    if (!dry) {
      fs.writeFileSync(currentBookPath, JSON.stringify(currentJson, null, 2), 'utf8');
      console.log('Updated', currentBookPath);
      if (cbBackup) console.log('Created backup:', cbBackup);
    } else {
      console.log('--dry mode: current_book.json not written.');
    }

  } catch (err) {
    console.error('Error updating current_book.json', err);
  }

  console.log('\nSummary:');
  console.log('- Title:', title);
  console.log('- Author:', author);
  console.log('- Year:', year || 'N/A');
  console.log('- Date label:', date || 'N/A');
  console.log('- Rating:', rating===null? 'N/A' : rating);
  console.log('- Dry run:', dry);
  console.log('\nDone. Please open index.html and verify the arrays render correctly.');

} catch (err) {
  console.error('Fatal error:', err);
  process.exit(1);
}
