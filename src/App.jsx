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

  const [language, setLanguage] = useState('en'); // 'en' or 'id'

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const spinAudio = useRef(new Audio('/sounds/spin.wav'));
  const winAudio = useRef(new Audio('/sounds/win.wav'));

  // --- Background handling
  useEffect(() => {
    const base = (import.meta && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
    const bgPath = `${base.replace(/\/$/, '')}/bg.jpg`.replace('//bg.jpg', '/bg.jpg');

    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    const previous = {
      htmlHeight: htmlEl.style.height || '',
      bodyHeight: bodyEl.style.height || '',
      bodyMargin: bodyEl.style.margin || '',
      bodyBgImage: bodyEl.style.backgroundImage || '',
      bodyBgSize: bodyEl.style.backgroundSize || '',
      bodyBgPos: bodyEl.style.backgroundPosition || '',
      bodyBgRepeat: bodyEl.style.backgroundRepeat || '',
      bodyBgAttach: bodyEl.style.backgroundAttachment || ''
    };

    htmlEl.style.height = '';
bodyEl.style.height = '';
bodyEl.style.minHeight = '100vh';
bodyEl.style.margin = '0';
bodyEl.style.backgroundImage = `url('${bgPath}')`;
bodyEl.style.backgroundSize = 'cover';
bodyEl.style.backgroundPosition = 'center center';
bodyEl.style.backgroundRepeat = 'no-repeat';
bodyEl.style.backgroundAttachment = 'fixed';


    return () => {
      htmlEl.style.height = previous.htmlHeight;
      bodyEl.style.height = previous.bodyHeight;
      bodyEl.style.margin = previous.bodyMargin;
      bodyEl.style.backgroundImage = previous.bodyBgImage;
      bodyEl.style.backgroundSize = previous.bodyBgSize;
      bodyEl.style.backgroundPosition = previous.bodyBgPos;
      bodyEl.style.backgroundRepeat = previous.bodyBgRepeat;
      bodyEl.style.backgroundAttachment = previous.bodyBgAttach;
    };
  }, []);

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

  // Load prizes
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

  // Load spin logs
  useEffect(() => {
    const q = query(collection(db, 'spins'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLogs(entries);
      setCurrentPage(1);
    });
    return () => unsubscribe();
  }, []);

  function handleApplyBooking() {
    const id = bookingIdInput.trim();
    if (!id) return alert(language==='en' ? 'Booking ID is required' : 'ID Pemesanan dibutuhkan');
    setBookingId(id);
    setBookingIdInput('');
    setAllowSpin(true);
    setResult(null);
  }

  async function handleSpin() {
    if (!bookingId) return alert(language==='en' ? 'Please enter a Booking ID first' : 'Silakan masukkan ID Pemesanan terlebih dahulu');
    if (prizes.length === 0) return alert(language==='en' ? 'No prizes configured' : 'Belum ada hadiah yang dikonfigurasi');

    const { prize: selected, index } = pickPrizeByProbability(prizes);
    setSpinning(true);
    setResult(null);
    setResultIndex(index);

    spinAudio.current.loop = true;
    spinAudio.current.currentTime = 0;
    spinAudio.current.playbackRate = 3;
    spinAudio.current.play();

    const spinDuration = 7000;

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

      alert(language==='en' 
        ? `🎉 YOU WON: ${selected.label}\nPlease take a screenshot to claim your prize.`
        : `🎉 ANDA MENANG: ${selected.label}\nSilakan screenshot untuk klaim hadiah.`);
    }, spinDuration);
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
    else alert(language==='en' ? 'Wrong admin password' : 'Password admin salah');
    setAdminPasswordInput('');
  }

  function handlePrizeLogin() {
    if (prizePasswordInput === ADMIN_PRIZES_PASSWORD) setAdminLevel(2);
    else alert(language==='en' ? 'Wrong prize password' : 'Password hadiah salah');
    setPrizePasswordInput('');
  }

  async function adminAddPrize() {
    const label = prompt(language==='en' ? 'Prize label?' : 'Label hadiah?');
    if (!label) return;
    const probStr = prompt(language==='en' ? 'Probability percent?' : 'Persentase probabilitas?');
    const prob = parseFloat(probStr);
    if (isNaN(prob) || prob <= 0) return alert(language==='en' ? 'invalid probability' : 'probabilitas tidak valid');
    try {
      await addDoc(collection(db, 'prizes'), { label, probability: prob });
    } catch (err) {
      console.error(err);
    }
  }

  async function adminEditPrize(prize) {
    const label = prompt(language==='en' ? 'Prize label?' : 'Label hadiah?', prize.label);
    if (!label) return;
    const probStr = prompt(language==='en' ? 'Probability percent?' : 'Persentase probabilitas?', String(prize.probability || 0));
    const prob = parseFloat(probStr);
    if (isNaN(prob) || prob < 0) return alert(language==='en' ? 'invalid probability' : 'probabilitas tidak valid');
    try {
      const ref = doc(db, 'prizes', prize.id);
      await updateDoc(ref, { label, probability: prob });
    } catch (err) {
      console.error(err);
    }
  }

  async function adminDeletePrize(prize) {
    if (!window.confirm(language==='en' ? 'Delete this prize?' : 'Hapus hadiah ini?')) return;
    try {
      await deleteDoc(doc(db, 'prizes', prize.id));
    } catch (err) {
      console.error(err);
    }
  }

  const totalPages = Math.ceil(logs.length / pageSize);
  const paginatedLogs = logs.slice((currentPage-1)*pageSize, currentPage*pageSize);

  // Helper for outline style
  const textOutlineStyle = (color) => ({
    color: 'white',
    WebkitTextStroke: `1px ${color}`,
    textStroke: `1px ${color}`
  });

  return (
    <div className="relative min-h-screen w-full font-sans">
      <div
        className="absolute inset-0 z-10"
        style={{
          backgroundColor: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(3px)'
        }}
      />

      {/* content wrapper: no mx-auto (you said no auto margin), add top padding so header isn't cut */}
      <div
        className="relative z-20 w-full max-w-4xl px-4 pt-16 pb-8"
        style={{ paddingTop: '1rem' }}
      >
        {/* simplified header per your request (no items-center, no justify-between) */}
        <header className="flex flex-col sm:flex-row w-full mb-6">
          <h1 className="text-3xl font-bold mb-3 sm:mb-0 leading-tight" style={textOutlineStyle('#ffffff')}>
            {language==='en' ? 'Millennium TikTok Spin' : 'Putar TikTok Millennium'}
          </h1>
          <div className="flex items-center gap-2">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="px-2 py-1 rounded border bg-gray-700 text-white"
            >
              <option value="en">English</option>
              <option value="id">Bahasa Indonesia</option>
            </select>

            {adminLevel === 0 ? (
              <div className="flex gap-2">
                <input
                  placeholder={language==='en' ? "Admin password" : "Password admin"}
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  className="border px-2 py-1 rounded"
                />
                <button onClick={handleAdminLogin} className="px-3 py-1 bg-indigo-600 text-white rounded">
                  {language==='en' ? 'Admin' : 'Admin'}
                </button>
              </div>
            ) : (
              <button onClick={() => setAdminLevel(0)} className="px-3 py-1 bg-red-500 text-white rounded">
                {language==='en' ? 'Exit Admin' : 'Keluar Admin'}
              </button>
            )}
          </div>
        </header>

        {adminLevel === 0 && (
          <main className="flex flex-col items-center w-full max-w-2xl">
            <div className="mb-6 w-full">
              <label className="block mb-1 font-medium" style={textOutlineStyle('#ffffff')}>
                {language==='en' ? 'Booking ID:' : 'ID Pemesanan:'}
              </label>
              <div className="flex gap-2">
                <input
                  value={bookingIdInput}
                  onChange={(e) => setBookingIdInput(e.target.value)}
                  placeholder={language==='en' ? "Enter booking id" : "Masukkan ID pemesanan"}
                  className="flex-1 border px-2 py-2 rounded"
                />
                <button onClick={handleApplyBooking} className="px-4 py-2 bg-green-600 text-white rounded">
                  {language==='en' ? 'Apply' : 'Terapkan'}
                </button>
              </div>
              {bookingId && (
                <div className="mt-2 text-sm font-medium" style={textOutlineStyle('#ffffff')}>
                  {language==='en' ? 'Current Booking ID:' : 'ID Pemesanan Saat Ini:'} <strong>{bookingId}</strong>
                </div>
              )}
            </div>

            <div className="w-full max-w-full max-h-[80vw] min-h-[300px] h-auto relative">
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
                <div className="flex items-center justify-center h-80 text-gray-400">
                  {language==='en' ? 'No prizes configured' : 'Belum ada hadiah'}
                </div>
              )}
            </div>

            <div className="mt-6">
              <button
                onClick={handleSpin}
                disabled={spinning || !allowSpin}
                className={`px-8 py-3 rounded text-white text-lg ${
                  spinning || !allowSpin ? 'bg-gray-400' : 'bg-yellow-500'
                }`}
              >
                {spinning ? (language==='en' ? 'Spinning...' : 'Sedang berputar...') : (language==='en' ? 'SPIN' : 'PUTAR')}
              </button>
            </div>

            {result && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded text-center">
                <h3 className="font-semibold text-green-800">
                  {language==='en' ? 'You won:' : 'Anda menang:'}
                </h3>
                <div className="text-xl font-bold text-green-900">{result.label}</div>
                <div className="text-sm mt-2 text-green-700">
                  {language==='en' ? 'Please screenshot this screen to claim your prize.' : 'Silakan screenshot layar ini untuk klaim hadiah.'}
                </div>
              </div>
            )}

            <div className="mt-6 text-xs text-white text-center">
              {language==='en'
                ? 'Each spin requires entering a booking ID. After one spin, you must apply another booking ID to spin again.'
                : 'Setiap putaran membutuhkan ID pemesanan. Setelah satu putaran, masukkan ID baru untuk berputar lagi.'}
            </div>
          </main>
        )}

        {adminLevel >= 1 && (
          <AdminPanel
            prizes={prizes}
            logs={paginatedLogs}
            totalPages={totalPages}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            adminLevel={adminLevel}
            prizePasswordInput={prizePasswordInput}
            setPrizePasswordInput={setPrizePasswordInput}
            onPrizeLogin={handlePrizeLogin}
            onAddPrize={adminAddPrize}
            onEditPrize={adminEditPrize}
            onDeletePrize={adminDeletePrize}
            language={language}
          />
        )}
      </div>
    </div>
  );
}

// AdminPanel component remains unchanged
function AdminPanel({
  prizes,
  logs,
  totalPages,
  currentPage,
  setCurrentPage,
  adminLevel,
  prizePasswordInput,
  setPrizePasswordInput,
  onPrizeLogin,
  onAddPrize,
  onEditPrize,
  onDeletePrize,
  language
}) {
  return (
    <div className="w-full max-w-4xl mt-6 text-white">
      <h2 className="text-lg font-semibold mb-3">{language==='en' ? 'Admin Dashboard' : 'Dashboard Admin'}</h2>

      {adminLevel === 1 && (
        <div className="mb-4 flex gap-2">
          <input
            placeholder={language==='en' ? "Prize editor password" : "Password editor hadiah"}
            value={prizePasswordInput}
            onChange={(e) => setPrizePasswordInput(e.target.value)}
            className="border px-2 py-1 rounded"
          />
          <button onClick={onPrizeLogin} className="px-3 py-1 bg-indigo-600 text-white rounded">
            {language==='en' ? 'Unlock Prize Editor' : 'Buka Editor Hadiah'}
          </button>
        </div>
      )}

      {adminLevel === 2 && (
        <>
          <div className="mb-4">
            <button onClick={onAddPrize} className="px-3 py-1 bg-green-600 text-white rounded mr-2">
              {language==='en' ? 'Add Prize' : 'Tambah Hadiah'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse border border-gray-400">
              <thead>
                <tr className="bg-gray-700 text-white">
                  <th className="border px-2 py-1">{language==='en' ? 'Label' : 'Label'}</th>
                  <th className="border px-2 py-1">{language==='en' ? 'Probability' : 'Probabilitas'}</th>
                  <th className="border px-2 py-1">{language==='en' ? 'Actions' : 'Aksi'}</th>
                </tr>
              </thead>
              <tbody>
                {prizes.map((p) => (
                  <tr key={p.id} className="bg-gray-800">
                    <td className="border px-2 py-1">{p.label}</td>
                    <td className="border px-2 py-1">{p.probability}</td>
                    <td className="border px-2 py-1 flex gap-2">
                      <button onClick={() => onEditPrize(p)} className="px-2 py-1 bg-yellow-500 rounded text-white">
                        {language==='en' ? 'Edit' : 'Edit'}
                      </button>
                      <button onClick={() => onDeletePrize(p)} className="px-2 py-1 bg-red-500 rounded text-white">
                        {language==='en' ? 'Delete' : 'Hapus'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-6">
        <h3 className="text-md font-semibold mb-2">{language==='en' ? 'Recent Spins' : 'Putaran Terbaru'}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse border border-gray-400">
            <thead>
              <tr className="bg-gray-700 text-white">
                <th className="border px-2 py-1">Booking ID</th>
                <th className="border px-2 py-1">{language==='en' ? 'Prize' : 'Hadiah'}</th>
                <th className="border px-2 py-1">{language==='en' ? 'Date' : 'Tanggal'}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="bg-gray-800">
                  <td className="border px-2 py-1">{log.bookingId}</td>
                  <td className="border px-2 py-1">{log.prizeLabel}</td>
                  <td className="border px-2 py-1">{log.createdAt?.toDate?.()?.toLocaleString() || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex justify-between">
          <button
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage(currentPage - 1)}
            className="px-3 py-1 bg-gray-600 text-white rounded disabled:opacity-50"
          >
            {language==='en' ? 'Prev' : 'Sebelumnya'}
          </button>
          <span>{currentPage} / {totalPages}</span>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage(currentPage + 1)}
            className="px-3 py-1 bg-gray-600 text-white rounded disabled:opacity-50"
          >
            {language==='en' ? 'Next' : 'Berikutnya'}
          </button>
        </div>
      </div>
    </div>
  );
}
