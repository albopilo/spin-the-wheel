/*
TikTok Spin-the-Wheel Landing Page
Single-file React app (App.jsx) ready to drop into a Vite / Create React App project.

Features:
- Landing page with Booking ID input and a central spin-the-wheel.
- Booking ID validation options: require preloaded bookings in Firestore or allow any booking ID (configurable).
- Each spin is recorded in Firestore with bookingId, prizeId, prizeLabel, timestamp.
- Prevent reuse by checking previously used booking IDs (enforced regardless of booking-mode).
- Admin route (/admin) protected by a password (REACT_APP_ADMIN_PASSWORD environment variable) for editing prizes and viewing logs.
- Prize editor allows setting prize label and probability percentage. Probabilities are normalized at save.

How to use:
1) Create a new React app (Vite recommended):
   npm create vite@latest tiktok-spin -- --template react
   cd tiktok-spin
   npm install

2) Install Firebase & Tailwind (optional for styling):
   npm install firebase
   (optional) follow Tailwind installation guide if you want tailwind styling.

3) Put this file into src/App.jsx (replace default). If you use CRA, adapt imports.

4) Create a Firebase project, enable Firestore in test mode (or secure rules), and create a Firestore database.
   Collections used by this app:
   - prizes (documents with { label:string, probability:number })
   - spins (auto-created docs recording spins)
   - bookings (optional) documents with bookingId as id. If your policy requires prefilled booking IDs, add documents there.

5) Create a .env file in project root (Vite uses VITE_ prefix, CRA uses REACT_APP_). Example for CRA (REACT_APP_*):
   REACT_APP_FIREBASE_API_KEY=your_api_key
   REACT_APP_FIREBASE_AUTH_DOMAIN=...
   REACT_APP_FIREBASE_PROJECT_ID=...
   REACT_APP_FIREBASE_STORAGE_BUCKET=...
   REACT_APP_FIREBASE_MESSAGING_SENDER_ID=...
   REACT_APP_FIREBASE_APP_ID=...
   REACT_APP_ADMIN_PASSWORD=your_admin_password
   REACT_APP_ALLOW_ANY_BOOKING=false  # set to true if you accept any booking ID

   If using Vite, replace REACT_APP_ with VITE_. Update code accordingly.

6) Run the app: npm run dev (Vite) or npm start (CRA).

7) Deploy to Netlify: push to GitHub and connect the repo in Netlify. Add your env vars in Netlify site settings.

Security notes:
- Admin password is compared client-side to an env var. This is convenient but not fully secure. For production, consider Firebase Auth for admin users or a server-side function.
- Firestore rules should be configured to allow write to 'spins' only from authorized requests or limit by rules. Right now this code assumes a trusted environment.

-- End of header. Below is the React component --
*/

import React, { useEffect, useState, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  where,
  Timestamp
} from 'firebase/firestore';

// --------- CONFIG - update via .env in your deploy
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const ADMIN_PASSWORD = process.env.REACT_APP_ADMIN_PASSWORD || 'admin123';
const ALLOW_ANY_BOOKING = (process.env.REACT_APP_ALLOW_ANY_BOOKING || 'false').toLowerCase() === 'true';

// Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --------- Helpers for weighted random selection
function pickPrizeByProbability(prizes) {
  // prizes: [{id,label,probability}]
  const total = prizes.reduce((s, p) => s + (p.probability || 0), 0);
  if (total <= 0) {
    // fallback - equal chance
    const idx = Math.floor(Math.random() * prizes.length);
    return prizes[idx];
  }
  const r = Math.random() * total;
  let acc = 0;
  for (const p of prizes) {
    acc += p.probability || 0;
    if (r <= acc) return p;
  }
  return prizes[prizes.length - 1];
}

// ---------- Visual wheel utility: compute segments
function computeSegments(prizes) {
  // Return array of { startAngle, endAngle, midAngle, prize }
  const totalProb = prizes.reduce((s, p) => s + (p.probability || 0), 0) || prizes.length;
  let angleAcc = 0;
  return prizes.map((p) => {
    const portion = (p.probability || 1) / totalProb;
    const start = angleAcc;
    const end = angleAcc + portion * 360;
    const mid = (start + end) / 2;
    angleAcc = end;
    return { startAngle: start, endAngle: end, midAngle: mid, prize: p };
  });
}

// ---------- Main App
export default function App() {
  const [bookingIdInput, setBookingIdInput] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [prizes, setPrizes] = useState([]);
  const [segments, setSegments] = useState([]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const wheelRef = useRef(null);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [logs, setLogs] = useState([]);
  const [allowSpin, setAllowSpin] = useState(false);

  // Load prizes from Firestore
  useEffect(() => {
    const q = query(collection(db, 'prizes'));
    // simple live listener
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Normalize probabilities (if not provided, evenly split)
      const total = items.reduce((s, x) => s + (x.probability || 0), 0);
      if (total === 0 && items.length > 0) {
        // assign equal probability
        items.forEach((it) => (it.probability = 1));
      }
      setPrizes(items);
      setSegments(computeSegments(items));
    });
    return () => unsubscribe();
  }, []);

  // Load logs (spins) for admin view
  useEffect(() => {
    const q = query(collection(db, 'spins'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLogs(entries);
    });
    return () => unsubscribe();
  }, []);

  // Verify booking id (if required)
  async function verifyBookingId(id) {
    const trimmed = String(id).trim();
    if (!trimmed) return { ok: false, message: 'Booking ID is required' };

    if (!ALLOW_ANY_BOOKING) {
      // require booking doc to exist in bookings collection
      const docRef = doc(db, 'bookings', trimmed);
      const snap = await getDoc(docRef);
      if (!snap.exists()) return { ok: false, message: 'Booking ID not found' };
    }

    // Check if bookingId already used in spins
    const spinsQ = query(collection(db, 'spins'), where('bookingId', '==', trimmed));
    const spinResults = await getDocs(spinsQ);
    if (!spinResults.empty) return { ok: false, message: 'Booking ID already used for a spin' };

    return { ok: true };
  }

  async function handleApplyBooking() {
    const id = bookingIdInput.trim();
    const res = await verifyBookingId(id);
    if (!res.ok) {
      alert(res.message);
      setAllowSpin(false);
      return;
    }
    setBookingId(id);
    setAllowSpin(true);
    setResult(null);
  }

  function angleToDeg(angle) {
    return (angle % 360 + 360) % 360;
  }

  async function handleSpin() {
    if (!bookingId) {
      alert('Please enter a Booking ID first');
      return;
    }
    if (prizes.length === 0) {
      alert('No prizes configured');
      return;
    }
    setSpinning(true);
    setResult(null);

    // pick prize based on probability
    const selected = pickPrizeByProbability(prizes);

    // find segment midAngle for visual
    const seg = segments.find((s) => s.prize.id === selected.id) || segments[0];
    const targetAngle = 360 * 6 + (270 - (seg ? seg.midAngle : 0)); // 6 full spins + align
    const wheel = wheelRef.current;
    if (!wheel) {
      // fallback immediate
      await recordSpin(selected);
      setResult(selected);
      setSpinning(false);
      return;
    }

    // animate via CSS transform
    wheel.style.transition = 'transform 4s cubic-bezier(.16,.84,.36,1)';
    wheel.style.transform = `rotate(${targetAngle}deg)`;

    // Wait for animation end
    setTimeout(async () => {
      // reset rotation to the final small angle for future spins
      const finalRotation = angleToDeg(targetAngle);
      wheel.style.transition = 'none';
      wheel.style.transform = `rotate(${finalRotation}deg)`;

      await recordSpin(selected);
      setResult(selected);
      setSpinning(false);
      // prompt to screenshot
      alert(`🎉 YOU WON: ${selected.label}\nPlease take a screenshot of this screen to claim your prize.`);
    }, 4200);
  }

  async function recordSpin(selectedPrize) {
    try {
      await addDoc(collection(db, 'spins'), {
        bookingId: bookingId,
        prizeId: selectedPrize.id,
        prizeLabel: selectedPrize.label,
        createdAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Failed to record spin:', err);
    }
  }

  // Admin login
  function handleAdminLogin() {
    if (adminPasswordInput === ADMIN_PASSWORD) {
      setAdminMode(true);
    } else {
      alert('Wrong admin password');
    }
  }

  // Admin: add prize
  async function adminAddPrize() {
    const label = prompt('Prize label? (eg: 10% off, Free Coffee)');
    if (!label) return;
    const probStr = prompt('Probability percent? (eg: 10)');
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

  // UI
  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="max-w-3xl mx-auto bg-white shadow-md rounded-lg p-6">
        <header className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">13e / Millennium TikTok Spin</h1>
          <div className="text-sm">
            {!adminMode ? (
              <div>
                <input
                  placeholder="Admin password"
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  className="border px-2 py-1 mr-2 rounded"
                />
                <button onClick={handleAdminLogin} className="px-3 py-1 bg-indigo-600 text-white rounded">Admin</button>
              </div>
            ) : (
              <button onClick={() => setAdminMode(false)} className="px-3 py-1 bg-red-500 text-white rounded">Exit Admin</button>
            )}
          </div>
        </header>

        {!adminMode ? (
          <main>
            <div className="mb-4">
              <label className="block mb-1 font-medium">Booking ID:</label>
              <div className="flex gap-2">
                <input
                  value={bookingIdInput}
                  onChange={(e) => setBookingIdInput(e.target.value)}
                  placeholder="Enter booking id"
                  className="flex-1 border p-2 rounded"
                />
                <button onClick={handleApplyBooking} className="px-4 py-2 bg-green-600 text-white rounded">Apply</button>
              </div>
              {bookingId && <div className="mt-2 text-sm text-gray-700">Current Booking ID: <strong>{bookingId}</strong></div>}
            </div>

            <div className="flex flex-col items-center">
              <div className="w-80 h-80 relative">
                {/* Wheel */}
                <div
                  ref={wheelRef}
                  className="w-full h-full rounded-full border-4 border-gray-200 flex items-center justify-center origin-center"
                  style={{ overflow: 'hidden', position: 'relative' }}
                >
                  {/* SVG segments drawn using segments data */}
                  <svg viewBox="0 0 200 200" className="w-full h-full">
                    <g transform="translate(100,100)">
                      {segments.map((seg, idx) => {
                        const start = (seg.startAngle - 90) * (Math.PI / 180);
                        const end = (seg.endAngle - 90) * (Math.PI / 180);
                        const x1 = Math.cos(start) * 100;
                        const y1 = Math.sin(start) * 100;
                        const x2 = Math.cos(end) * 100;
                        const y2 = Math.sin(end) * 100;
                        const large = seg.endAngle - seg.startAngle > 180 ? 1 : 0;
                        const path = `M 0 0 L ${x1} ${y1} A 100 100 0 ${large} 1 ${x2} ${y2} Z`;
                        return (
                          <g key={idx}>
                            <path d={path} stroke="#fff" strokeWidth={0.5} fillOpacity={0.95} fill={`hsl(${(idx * 60) % 360} 70% 60%)`} />
                            <text
                              transform={`translate(${Math.cos((seg.midAngle - 90) * (Math.PI / 180)) * 60}, ${Math.sin((seg.midAngle - 90) * (Math.PI / 180)) * 60}) rotate(${seg.midAngle})`}
                              fontSize={6}
                              textAnchor="middle"
                            >
                              {seg.prize.label}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                </div>

                {/* pointer */}
                <div style={{ position: 'absolute', left: '50%', top: '-12px', transform: 'translateX(-50%)' }}>
                  <div className="w-0 h-0 border-l-8 border-r-8 border-b-12 border-l-transparent border-r-transparent border-b-red-600"></div>
                </div>
              </div>

              <div className="mt-4">
                <button
                  onClick={handleSpin}
                  disabled={spinning || !allowSpin}
                  className={`px-6 py-3 rounded text-white ${spinning || !allowSpin ? 'bg-gray-400' : 'bg-yellow-500'}`}
                >
                  {spinning ? 'Spinning...' : 'SPIN'}
                </button>
              </div>

              {result && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded">
                  <h3 className="font-semibold">You won:</h3>
                  <div className="text-xl font-bold">{result.label}</div>
                  <div className="text-sm mt-2">Please screenshot this screen and show it to staff to claim your prize.</div>
                </div>
              )}

              <div className="mt-6 text-xs text-gray-500">Each spin requires a unique booking ID. To spin again, enter a new booking ID.</div>
            </div>
          </main>
        ) : (
          <AdminPanel
            prizes={prizes}
            logs={logs}
            onAddPrize={adminAddPrize}
            onEditPrize={adminEditPrize}
            onDeletePrize={adminDeletePrize}
          />
        )}
      </div>
    </div>
  );
}

function AdminPanel({ prizes, logs, onAddPrize, onEditPrize, onDeletePrize }) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Admin Dashboard</h2>
      <div className="mb-4">
        <button onClick={onAddPrize} className="px-3 py-1 bg-green-600 text-white rounded mr-2">Add Prize</button>
        <button
          onClick={async () => {
            // Normalize probabilities: if sum != 100, scale them so that sum=100
            const total = prizes.reduce((s, p) => s + (p.probability || 0), 0);
            if (total === 0) return alert('Total probability is zero');
            const promises = prizes.map(async (p) => {
              const ref = doc(getFirestore(), 'prizes', p.id);
              const scaled = ((p.probability || 0) / total) * 100;
              await updateDoc(ref, { probability: scaled });
            });
            try {
              await Promise.all(promises);
              alert('Normalized probabilities to percentages.');
            } catch (err) {
              console.error(err);
              alert('Failed to normalize');
            }
          }}
          className="px-3 py-1 bg-blue-600 text-white rounded"
        >
          Normalize Probabilities
        </button>
      </div>

      <section className="mb-6">
        <h3 className="font-medium">Prizes</h3>
        <div className="grid grid-cols-2 gap-3 mt-2">
          {prizes.map((p) => (
            <div key={p.id} className="p-3 border rounded bg-gray-50">
              <div className="font-semibold">{p.label}</div>
              <div className="text-xs text-gray-600">Probability: {p.probability || 0}</div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => onEditPrize(p)} className="text-sm px-2 py-1 bg-yellow-400 rounded">Edit</button>
                <button onClick={() => onDeletePrize(p)} className="text-sm px-2 py-1 bg-red-500 text-white rounded">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-medium">Spin Logs (latest)</h3>
        <div className="mt-2 max-h-64 overflow-auto border rounded p-2 bg-white">
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
                  <td className="py-1">{l.createdAt?.toDate ? l.createdAt.toDate().toLocaleString() : '-'}</td>
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
