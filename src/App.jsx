import React, { useEffect, useState, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  query,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { Wheel } from 'react-custom-roulette';

// --------- CONFIG - Vite env (VITE_ prefix)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const ADMIN_LOGS_PASSWORD = import.meta.env.VITE_ADMIN_LOGS_PASSWORD || 'secret123';
const ADMIN_PRIZES_PASSWORD = import.meta.env.VITE_ADMIN_PRIZES_PASSWORD || 'supersecret123';

// Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- Main App
export default function App() {
  const [bookingIdInput, setBookingIdInput] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [prizes, setPrizes] = useState([]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [resultIndex, setResultIndex] = useState(0);

  const [adminLevel, setAdminLevel] = useState(0);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [prizePasswordInput, setPrizePasswordInput] = useState('');

  const [logs, setLogs] = useState([]);
  const [allowSpin, setAllowSpin] = useState(false);

  const spinAudio = useRef(new Audio('/sounds/spin.wav'));
  const winAudio = useRef(new Audio('/sounds/win.wav'));

  // Weighted random selection
  function pickPrizeByProbability(prizes) {
    const total = prizes.reduce((s, p) => s + (p.probability || 0), 0);
    if (total <= 0) {
      const idx = Math.floor(Math.random() * prizes.length);
      return { prize: prizes[idx], index: idx };
    }
    const r = Math.random() * total;
    let acc = 0;
    for (let i = 0; i < prizes.length; i++) {
      acc += prizes[i].probability || 0;
      if (r <= acc) return { prize: prizes[i], index: i };
    }
    return { prize: prizes[prizes.length - 1], index: prizes.length - 1 };
  }

  useEffect(() => {
    const q = query(collection(db, 'prizes'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const total = items.reduce((s, x) => s + (x.probability || 0), 0);
      if (total === 0 && items.length > 0) {
        items.forEach((it) => (it.probability = 1));
      }
      setPrizes(items);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'spins'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLogs(entries);
    });
    return () => unsubscribe();
  }, []);

  function handleApplyBooking() {
    const id = bookingIdInput.trim();
    if (!id) return alert('Booking ID is required');
    setBookingId(id);
    setBookingIdInput('');
    setAllowSpin(true);
    setResult(null);
  }

  async function handleSpin() {
    if (!bookingId) return alert('Please enter a Booking ID first');
    if (prizes.length === 0) return alert('No prizes configured');

    const { prize: selected, index } = pickPrizeByProbability(prizes);
    setSpinning(true);
    setResult(null);
    setResultIndex(index);

    spinAudio.current.loop = true;
    spinAudio.current.currentTime = 0;
    spinAudio.current.play();

    setTimeout(async () => {
      await recordSpin(selected);
      setResult(selected);
      setSpinning(false);
      setAllowSpin(false);
      setBookingId('');

      spinAudio.current.pause();
      spinAudio.current.loop = false;
      spinAudio.current.currentTime = 0;
      winAudio.current.currentTime = 0;
      winAudio.current.play();

      alert(`🎉 YOU WON: ${selected.label}\nPlease take a screenshot to claim your prize.`);
    }, 4200);
  }

  async function recordSpin(selectedPrize) {
    try {
      await addDoc(collection(db, 'spins'), {
        bookingId,
        prizeId: selectedPrize.id,
        prizeLabel: selectedPrize.label,
        createdAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Failed to record spin:', err);
    }
  }

  function handleAdminLogin() {
    if (adminPasswordInput === ADMIN_LOGS_PASSWORD) setAdminLevel(1);
    else alert('Wrong admin password');
  }

  function handlePrizeLogin() {
    if (prizePasswordInput === ADMIN_PRIZES_PASSWORD) setAdminLevel(2);
    else alert('Wrong prize password');
  }

  async function adminAddPrize() {
    const label = prompt('Prize label?');
    if (!label) return;
    const probStr = prompt('Probability percent?');
    const prob = parseFloat(probStr);
    if (isNaN(prob) || prob <= 0) return alert('invalid probability');
    try {
      await addDoc(collection(db, 'prizes'), { label, probability: prob });
    } catch (err) {
      console.error(err);
    }
  }

  async function adminEditPrize(prize) {
    const label = prompt('Prize label?', prize.label);
    if (!label) return;
    const probStr = prompt('Probability percent?', String(prize.probability || 0));
    const prob = parseFloat(probStr);
    if (isNaN(prob) || prob < 0) return alert('invalid probability');
    try {
      const ref = doc(db, 'prizes', prize.id);
      await updateDoc(ref, { label, probability: prob });
    } catch (err) {
      console.error(err);
    }
  }

  async function adminDeletePrize(prize) {
    if (!window.confirm('Delete this prize?')) return;
    try {
      await deleteDoc(doc(db, 'prizes', prize.id));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="relative min-h-screen w-full font-sans">
      {/* Background */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/bg.jpg')" }}
      />
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Foreground content */}
      <div className="relative z-10 w-full max-w-4xl mx-auto px-4 py-6">
        <header className="flex flex-col sm:flex-row items-center justify-between w-full mb-6">
          <h1 className="text-3xl font-bold text-white mb-3 sm:mb-0">Millennium TikTok Spin</h1>
          <div className="text-sm">
            {adminLevel === 0 ? (
              <div className="flex gap-2">
                <input
                  placeholder="Admin password"
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  className="border px-2 py-1 rounded"
                />
                <button
                  onClick={handleAdminLogin}
                  className="px-3 py-1 bg-indigo-600 text-white rounded"
                >
                  Admin
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAdminLevel(0)}
                className="px-3 py-1 bg-red-500 text-white rounded"
              >
                Exit Admin
              </button>
            )}
          </div>
        </header>

        {adminLevel === 0 && (
          <main className="flex flex-col items-center w-full max-w-2xl">
            {/* Booking ID */}
            <div className="mb-6 w-full">
              <label className="block mb-1 text-white font-medium">Booking ID:</label>
              <div className="flex gap-2">
                <input
                  value={bookingIdInput}
                  onChange={(e) => setBookingIdInput(e.target.value)}
                  placeholder="Enter booking id"
                  className="flex-1 border px-2 py-2 rounded"
                />
                <button
                  onClick={handleApplyBooking}
                  className="px-4 py-2 bg-green-600 text-white rounded"
                >
                  Apply
                </button>
              </div>
              {bookingId && (
                <div className="mt-2 text-sm text-white">
                  Current Booking ID: <strong>{bookingId}</strong>
                </div>
              )}
            </div>

            {/* Wheel */}
            <div className="w-80 h-80 relative">
              {prizes.length > 0 ? (
                <Wheel
                  mustStartSpinning={spinning}
                  prizeNumber={resultIndex >= 0 ? resultIndex : 0}
                  data={prizes.filter((p) => p.label).map((p) => ({ option: p.label }))}
                  onStopSpinning={() => setSpinning(false)}
                  backgroundColors={['#FFDD57', '#FF6B6B', '#6BCB77', '#4D96FF', '#FF8C42']}
                  textColors={['#000']}
                  outerBorderColor="#ccc"
                  outerBorderWidth={5}
                  radiusLineColor="#fff"
                  radiusLineWidth={2}
                  fontSize={14}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  No prizes configured
                </div>
              )}
            </div>

            {/* Spin button */}
            <div className="mt-6">
              <button
                onClick={handleSpin}
                disabled={spinning || !allowSpin}
                className={`px-8 py-3 rounded text-white text-lg ${
                  spinning || !allowSpin ? 'bg-gray-400' : 'bg-yellow-500'
                }`}
              >
                {spinning ? 'Spinning...' : 'SPIN'}
              </button>
            </div>

            {/* Result */}
            {result && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded text-center">
                <h3 className="font-semibold text-green-800">You won:</h3>
                <div className="text-xl font-bold text-green-900">{result.label}</div>
                <div className="text-sm mt-2 text-green-700">
                  Please screenshot this screen to claim your prize.
                </div>
              </div>
            )}

            <div className="mt-6 text-xs text-white text-center">
              Each spin requires entering a booking ID. After one spin, you must apply another booking ID to spin again.
            </div>
          </main>
        )}

        {adminLevel >= 1 && (
          <AdminPanel
            prizes={prizes}
            logs={logs}
            adminLevel={adminLevel}
            prizePasswordInput={prizePasswordInput}
            setPrizePasswordInput={setPrizePasswordInput}
            onPrizeLogin={handlePrizeLogin}
            onAddPrize={adminAddPrize}
            onEditPrize={adminEditPrize}
            onDeletePrize={adminDeletePrize}
          />
        )}
      </div>
    </div>
  );
}

function AdminPanel({
  prizes,
  logs,
  adminLevel,
  prizePasswordInput,
  setPrizePasswordInput,
  onPrizeLogin,
  onAddPrize,
  onEditPrize,
  onDeletePrize
}) {
  return (
    <div className="w-full max-w-4xl mt-6 text-white">
      <h2 className="text-lg font-semibold mb-3">Admin Dashboard</h2>

      {adminLevel === 1 && (
        <div className="mb-4 flex gap-2">
          <input
            placeholder="Prize editor password"
            value={prizePasswordInput}
            onChange={(e) => setPrizePasswordInput(e.target.value)}
            className="border px-2 py-1 rounded"
          />
          <button onClick={onPrizeLogin} className="px-3 py-1 bg-indigo-600 text-white rounded">
            Unlock Prize Editor
          </button>
        </div>
      )}

      {adminLevel === 2 && (
        <>
          <div className="mb-4">
            <button onClick={onAddPrize} className="px-3 py-1 bg-green-600 text-white rounded mr-2">
              Add Prize
            </button>
          </div>

          <section className="mb-6">
            <h3 className="font-medium">Prizes</h3>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {prizes.map((p) => (
                <div key={p.id} className="p-3 border rounded bg-gray-50 text-black">
                  <div className="font-semibold">{p.label}</div>
                  <div className="text-xs text-gray-600">Probability: {p.probability || 0}</div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => onEditPrize(p)} className="text-sm px-2 py-1 bg-yellow-400 rounded">
                      Edit
                    </button>
                    <button onClick={() => onDeletePrize(p)} className="text-sm px-2 py-1 bg-red-500 text-white rounded">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section>
        <h3 className="font-medium">Spin Logs (latest)</h3>
        <div className="mt-2 max-h-64 overflow-auto border rounded p-2 bg-white text-black">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-600">
                <th>Time</th>
                <th>Booking ID</th>
                <th>Prize</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="py-1">
                    {l.createdAt?.toDate ? l.createdAt.toDate().toLocaleString() : '-'}
                  </td>
                  <td className="py-1">{l.bookingId}</td>
                  <td className="py-1">{l.prizeLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
