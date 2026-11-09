import React, { useState, useEffect, useMemo } from 'react';
import './App.css';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
);

const API_BASE = 'https://smart-fishery-api.onrender.com/api';

export default function App() {
  const [series, setSeries] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [sensors, setSensors] = useState([]);
  const [activeSeriesIds, setActiveSeriesIds] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTimestamp, setSelectedTimestamp] = useState(null);

  // Autoryzacja administratora
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Formularze panelu admina
  const [newSeriesName, setNewSeriesName] = useState('');
  const [newSeriesMin, setNewSeriesMin] = useState('');
  const [newSeriesMax, setNewSeriesMax] = useState('');
  const [newSeriesColor, setNewSeriesColor] = useState('#2563eb');
  const [newSeriesUnit, setNewSeriesUnit] = useState('');
  const [newSensorName, setNewSensorName] = useState('');
  const [newSensorSeriesId, setNewSensorSeriesId] = useState('');
  const [createdApiKey, setCreatedApiKey] = useState(null);

  // Pobranie serii
  const loadSeries = () => {
    fetch(`${API_BASE}/series`)
      .then(res => res.json())
      .then(data => {
        setSeries(data);
        if (activeSeriesIds.length === 0) {
          setActiveSeriesIds(data.map(s => s.id));
        }
        if (!newSensorSeriesId && data.length > 0) {
          setNewSensorSeriesId(data[0].id);
        }
      })
      .catch(console.error);
  };

  // Pobranie czujników (gdy admin zalogowany)
  const loadSensors = (authToken) => {
    if (!authToken) return;
    fetch(`${API_BASE}/sensors`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
      .then(res => res.ok ? res.json() : [])
      .then(setSensors)
      .catch(console.error);
  };

  useEffect(() => {
    loadSeries();
  }, []);

  useEffect(() => {
    if (token) loadSensors(token);
  }, [token]);

  // Pobranie pomiarów
  const fetchMeasurements = () => {
    let url = `${API_BASE}/measurements?limit=1000`;
    if (activeSeriesIds.length > 0) {
      url += `&series=${activeSeriesIds.join(',')}`;
    }
    if (dateFrom) url += `&from=${new Date(dateFrom).toISOString()}`;
    if (dateTo) url += `&to=${new Date(dateTo).toISOString()}`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setMeasurements(data);
      })
      .catch(console.error);
  };

  useEffect(() => {
    if (series.length > 0) {
      fetchMeasurements();
    }
  }, [activeSeriesIds, dateFrom, dateTo, series]);

  // Logowanie
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.accessToken);
        localStorage.setItem('token', data.accessToken);
        setUsername('');
        setPassword('');
        loadSensors(data.accessToken);
      } else {
        setLoginError('Nieprawidłowy login lub hasło.');
      }
    } catch {
      setLoginError('Błąd połączenia z serwerem.');
    }
  };

  const handleLogout = async () => {
    if (token) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
    setToken('');
    localStorage.removeItem('token');
    setSensors([]);
  };

  // Dodanie nowej serii
  const handleAddSeries = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_BASE}/series`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: newSeriesName,
        minValue: Number(newSeriesMin),
        maxValue: Number(newSeriesMax),
        color: newSeriesColor,
        unit: newSeriesUnit
      })
    });
    if (res.ok) {
      setNewSeriesName('');
      setNewSeriesMin('');
      setNewSeriesMax('');
      setNewSeriesUnit('');
      loadSeries();
    } else {
      alert('Błąd tworzenia serii. Upewnij się, że min < max.');
    }
  };

  // Rejestracja czujnika
  const handleAddSensor = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_BASE}/sensors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: newSensorName,
        seriesId: Number(newSensorSeriesId)
      })
    });
    if (res.ok) {
      const data = await res.json();
      setCreatedApiKey(data.apiKey);
      setNewSensorName('');
      loadSensors(token);
    } else {
      alert('Błąd rejestracji czujnika.');
    }
  };

  const toggleSeries = (id) => {
    setActiveSeriesIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Wykres z podziałem na osie Y (F2):
  // Ciśnienie (hPa) -> prawa oś 'y1', pozostałe (temperatura, tlen) -> lewa oś 'y'
  const chartData = useMemo(() => {
    const datasets = series
      .filter(s => activeSeriesIds.includes(s.id))
      .map(s => {
        const points = measurements
          .filter(m => m.seriesId === s.id)
          .map(m => ({
            x: new Date(m.timestamp),
            y: m.value
          }));

        const isPressure = s.unit === 'hPa' || s.maxValue > 200;

        return {
          label: `${s.name} (${s.unit || ''})`,
          data: points,
          borderColor: s.color,
          backgroundColor: s.color,
          yAxisID: isPressure ? 'y1' : 'y',
          pointRadius: points.map(p =>
            selectedTimestamp && p.x.toISOString() === selectedTimestamp ? 8 : 3
          ),
          pointHoverRadius: 7,
          tension: 0.2
        };
      });

    return { datasets };
  }, [series, activeSeriesIds, measurements, selectedTimestamp]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    scales: {
      x: {
        type: 'time',
        time: {
          displayFormats: { minute: 'HH:mm', hour: 'dd.MM HH:mm' }
        },
        title: { display: true, text: 'Czas pomiaru' }
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: { display: true, text: 'Temperatura (°C) / Tlen (mg/l)' }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Ciśnienie (hPa)' }
      }
    }
  };

  // Tabela wyników (wspólna oś czasu)
  const tableRows = useMemo(() => {
    const map = new Map();
    measurements.forEach(m => {
      if (!map.has(m.timestamp)) {
        map.set(m.timestamp, {});
      }
      map.get(m.timestamp)[m.seriesId] = m.value;
    });

    return Array.from(map.entries())
      .map(([timestamp, values]) => ({ timestamp, values }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [measurements]);

  return (
    <div className="app-container">
      <header>
        <div>
          <h1>Smart Fishery – Monitoring Łowiska</h1>
          <p style={{ margin: 0, color: '#64748b' }}>System pomiarów parametrów wody i otoczenia</p>
        </div>
        <div className="no-print">
          <button onClick={() => window.print()} className="secondary" style={{ marginRight: '0.5rem' }}>
            Drukuj raport
          </button>
          {token ? (
            <button onClick={handleLogout} className="secondary">Wyloguj</button>
          ) : null}
        </div>
      </header>

      {/* Filtry i sterowanie (F5) */}
      <section className="controls-card no-print">
        <div className="control-group">
          <label>Wybór serii:</label>
          <div className="series-toggles">
            {series.map(s => (
              <label key={s.id} className="toggle-label">
                <input
                  type="checkbox"
                  checked={activeSeriesIds.includes(s.id)}
                  onChange={() => toggleSeries(s.id)}
                />
                <span style={{ color: s.color, fontWeight: 600 }}>{s.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="control-group">
          <label htmlFor="from-date">Od:</label>
          <input
            id="from-date"
            type="datetime-local"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </div>

        <div className="control-group">
          <label htmlFor="to-date">Do:</label>
          <input
            id="to-date"
            type="datetime-local"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>

        {(dateFrom || dateTo) && (
          <button
            className="secondary"
            onClick={() => { setDateFrom(''); setDateTo(''); }}
          >
            Resetuj filtry
          </button>
        )}
      </section>

      {/* Wykres (F1, F2 - czytelne porównanie z osobnymi osiami Y) */}
      <section className="chart-card">
        <Line data={chartData} options={chartOptions} />
      </section>

      {/* Tabela wyników (F1, F6) */}
      <section className="table-card">
        <h3>Tabela pomiarów (wspólna oś czasu)</h3>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 0 }}>
          Kliknij wiersz w tabeli, aby wyróżnić punkt pomiarowy na wykresie.
        </p>
        <table>
          <thead>
            <tr>
              <th>Data i czas</th>
              {series
                .filter(s => activeSeriesIds.includes(s.id))
                .map(s => (
                  <th key={s.id}>
                    {s.name} [{s.unit || '-'}]
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 ? (
              <tr>
                <td colSpan={activeSeriesIds.length + 1} style={{ textAlign: 'center', padding: '1rem' }}>
                  Brak danych w wybranym przedziale.
                </td>
              </tr>
            ) : (
              tableRows.map(row => {
                const isSelected = selectedTimestamp === row.timestamp;
                return (
                  <tr
                    key={row.timestamp}
                    className={isSelected ? 'selected-row' : ''}
                    onClick={() => setSelectedTimestamp(isSelected ? null : row.timestamp)}
                    title="Kliknij, aby podświetlić na wykresie"
                  >
                    <td>{new Date(row.timestamp).toLocaleString()}</td>
                    {series
                      .filter(s => activeSeriesIds.includes(s.id))
                      .map(s => (
                        <td key={s.id}>
                          {row.values[s.id] !== undefined ? row.values[s.id] : '—'}
                        </td>
                      ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {/* Panel administratora (F3, F8, F12) */}
      <section className="admin-panel no-print">
        {token ? (
          <div>
            <h3>Panel Administratora Łowiska</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
              
              {/* Formularz nowej serii (F3) */}
              <form onSubmit={handleAddSeries} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <h4 style={{ margin: 0 }}>Dodaj nową serię pomiarową</h4>
                <input
                  type="text"
                  placeholder="Nazwa serii (np. Przejrzystość wody)"
                  value={newSeriesName}
                  onChange={e => setNewSeriesName(e.target.value)}
                  required
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="number"
                    step="any"
                    placeholder="Wartość min"
                    value={newSeriesMin}
                    onChange={e => setNewSeriesMin(e.target.value)}
                    required
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Wartość max"
                    value={newSeriesMax}
                    onChange={e => setNewSeriesMax(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Jednostka (np. m, pH, %)"
                    value={newSeriesUnit}
                    onChange={e => setNewSeriesUnit(e.target.value)}
                  />
                  <input
                    type="color"
                    value={newSeriesColor}
                    onChange={e => setNewSeriesColor(e.target.value)}
                    title="Wybierz kolor"
                    style={{ height: '38px', width: '60px', padding: 0 }}
                  />
                </div>
                <button type="submit">Utwórz serię</button>
              </form>

              {/* Formularz rejestracji nowego czujnika (F12) */}
              <form onSubmit={handleAddSensor} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <h4 style={{ margin: 0 }}>Zarejestruj czujnik IoT</h4>
                <input
                  type="text"
                  placeholder="Nazwa czujnika (np. Boja pomiarowa #1)"
                  value={newSensorName}
                  onChange={e => setNewSensorName(e.target.value)}
                  required
                />
                <select
                  value={newSensorSeriesId}
                  onChange={e => setNewSensorSeriesId(e.target.value)}
                  style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                >
                  {series.map(s => (
                    <option key={s.id} value={s.id}>
                      Przypisz do: {s.name} ({s.unit})
                    </option>
                  ))}
                </select>
                <button type="submit">Generuj klucz i zarejestruj</button>

                {createdApiKey && (
                  <div style={{ background: '#ecfdf5', border: '1px solid #10b981', padding: '0.75rem', borderRadius: '4px', wordBreak: 'break-all', fontSize: '0.8rem' }}>
                    <strong style={{ color: '#047857' }}>Klucz API czujnika (zapisz go, nie będzie widoczny ponownie):</strong><br />
                    <code>{createdApiKey}</code>
                  </div>
                )}
              </form>
            </div>

            {/* Lista zarejestrowanych czujników */}
            <div style={{ marginTop: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem 0' }}>Aktywne czujniki w systemie ({sensors.length}):</h4>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
                {sensors.map(s => (
                  <li key={s.id}>
                    <strong>{s.name}</strong> (ID: {s.id}) – przypisany do serii #{s.seriesId} | Ostatni pomiar: {s.lastMeasurementAt ? new Date(s.lastMeasurementAt).toLocaleString() : 'brak'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div>
            <h3>Logowanie Administratora</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Zaloguj się kontem testowym, aby zarządzać seriami i rejestrować czujniki.</p>
            <form onSubmit={handleLogin} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Login"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Hasło"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button type="submit">Zaloguj się</button>
              {loginError && <span style={{ color: 'red', fontSize: '0.85rem' }}>{loginError}</span>}
            </form>
          </div>
        )}
      </section>
    </div>
  );
}