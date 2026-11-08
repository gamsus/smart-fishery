import db from './db.js';

const initialSeries = [
  { name: 'Temperatura wody', min_value: 0.0, max_value: 35.0, color: '#0284c7', unit: '°C' },
  { name: 'Ciśnienie atmosferyczne', min_value: 950.0, max_value: 1060.0, color: '#0d9488', unit: 'hPa' },
  { name: 'Rozpuszczony tlen', min_value: 0.0, max_value: 15.0, color: '#16a34a', unit: 'mg/l' }
];

const insert = db.prepare(`
  INSERT INTO series (name, min_value, max_value, color, unit)
  VALUES (@name, @min_value, @max_value, @color, @unit)
`);

const existing = db.prepare('SELECT COUNT(*) as count FROM series').get();
if (existing.count === 0) {
  for (const s of initialSeries) {
    insert.run(s);
  }
  console.log('Utworzono 3 domyślne serie dla łowiska.');
} else {
  console.log('Serie już istnieją w bazie.');
}