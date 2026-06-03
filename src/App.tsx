import React, { useState, useEffect, useMemo, useRef } from "react";
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval, startOfDay, addDays, getMonth, getYear } from "date-fns";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from "recharts";
import { Pencil, FileDown, Plus, Save, X, Calendar as CalendarIcon, TrendingUp, Package, Droplets, Target, Award, Trash2, PencilLine, Lock, Loader2, Eye, EyeOff, RefreshCw, Download } from "lucide-react";
import { cn } from "./lib/utils";
import jsPDF from "jspdf";
import { toPng } from "html-to-image";
import { signInAnonymously } from 'firebase/auth';
import { doc, onSnapshot, setDoc, collection, deleteDoc, query, where } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

const VIETNAM_CITIES = [
  "Ho Chi Minh City", "Hanoi", "Da Nang", "Hai Phong", "Can Tho",
  "An Giang", "Ba Ria - Vung Tau", "Bac Giang", "Bac Kan", "Bac Lieu",
  "Bac Ninh", "Ben Tre", "Binh Dinh", "Binh Duong", "Binh Phuoc",
  "Binh Thuan", "Ca Mau", "Cao Bang", "Dak Lak", "Dak Nong",
  "Dien Bien", "Dong Nai", "Dong Thap", "Gia Lai", "Ha Giang",
  "Ha Nam", "Ha Tinh", "Hai Duong", "Hau Giang", "Hoa Binh",
  "Hung Yen", "Khanh Hoa", "Kien Giang", "Kon Tum", "Lai Chau",
  "Lam Dong", "Lang Son", "Lao Cai", "Long An", "Nam Dinh",
  "Nghe An", "Ninh Binh", "Ninh Thuan", "Phu Tho", "Phu Yen",
  "Quang Binh", "Quang Nam", "Quang Ngai", "Quang Ninh", "Quang Tri",
  "Soc Trang", "Son La", "Tay Ninh", "Thai Binh", "Thai Nguyen",
  "Thanh Hoa", "Thua Thien Hue", "Tien Giang", "Tra Vinh", "Tuyen Quang",
  "Vinh Long", "Vinh Phuc", "Yen Bai"
];

// Types
type TargetData = { packets: number; litres: number };
type LogData = { id?: string; date: string; city: string; packets: number; litres: number; revenue: number };

// Helper format currency
const formatVND = (value: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
};

const TomYumBackground = React.memo(() => {
  const bigOilDrops = useMemo(() => Array.from({ length: 8 }).map(() => ({
    size: Math.random() * 50 + 30,
    left: `${Math.random() * 100}%`,
    animDuration: Math.random() * 5 + 4,
    simmerDuration: Math.random() * 15 + 15,
    delay: Math.random() * 20
  })), []);

  const fastBubbles = useMemo(() => Array.from({ length: 40 }).map(() => ({
    size: Math.random() * 14 + 4,
    left: `${Math.random() * 100}%`,
    animDuration: Math.random() * 2 + 1,
    simmerDuration: Math.random() * 4 + 2,
    delay: Math.random() * 8
  })), []);

  return (
    <>
      {/* Background Heat Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,_#A62100_0%,_#3A0A00_50%,_transparent_100%)] opacity-90"></div>

      {/* Big Oil Drops gently floating */}
      {bigOilDrops.map((drop, i) => (
         <div 
          key={`oil-${i}`}
          className="absolute pointer-events-none"
          style={{
            left: drop.left,
            bottom: '-20%',
            animation: `floatSpice ${drop.animDuration}s ease-in-out infinite alternate, simmerBubble ${drop.simmerDuration}s linear infinite`,
            animationDelay: `-${drop.delay}s`
          }}
        >
          <div 
            className="oil-drop"
            style={{
              width: `${drop.size}px`,
              height: `${drop.size}px`,
            }}
          />
        </div>
      ))}

      {/* Fast small boiling bubbles */}
      {fastBubbles.map((bubble, i) => (
         <div 
          key={`bubble-fast-${i}`}
          className="absolute pointer-events-none"
          style={{
            left: bubble.left,
            bottom: '-5%',
            animation: `floatSpice ${bubble.animDuration}s ease-in-out infinite alternate, simmerBubble ${bubble.simmerDuration}s ease-in infinite`,
            animationDelay: `-${bubble.delay}s`
          }}
        >
          <div 
            className="pure-bubble"
            style={{
              width: `${bubble.size}px`,
              height: `${bubble.size}px`,
            }}
          />
        </div>
      ))}

      {/* Steam Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#110300] via-[#110300]/20 to-transparent pointer-events-none"></div>
    </>
  );
});

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authToken, setAuthToken] = useState<string>("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Filters
  const [selectedMonth, setSelectedMonth] = useState<string>("2026-06");
  const [selectedCityFilter, setSelectedCityFilter] = useState<string>("All");

  const [target, setTarget] = useState<TargetData>({ packets: 2224, litres: +(2224/13).toFixed(2) });
  const [targetsMap, setTargetsMap] = useState<Record<string, TargetData>>({});
  const [logs, setLogs] = useState<LogData[]>([]);
  const [config, setConfig] = useState({ packets_per_litre: 13, vnd_per_packet: 48000 });
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // Fallback defaults
  const DEFAULTS = {
    targets: {},
    logs: [],
    config: { packets_per_litre: 13, vnd_per_packet: 48000 }
  };
  
  // Real-time listener for Firebase data
  useEffect(() => {
    if (!isAuthenticated || !authToken) return;
    
    // Tracker core listener
    const trackerRef = doc(db, 'trackers', authToken);
    const unsubscribeTracker = onSnapshot(trackerRef, async (snapshot) => {
      if (!snapshot.exists()) {
         try {
           await setDoc(trackerRef, {
             targets: DEFAULTS.targets,
             config: DEFAULTS.config
           });
         } catch (error) {
           handleFirestoreError(error, OperationType.CREATE, trackerRef.path);
         }
      } else {
         const data = snapshot.data();
         
         const loadedConfig = data.config || DEFAULTS.config;
         setConfig(loadedConfig);
         
         const loadedTargets = data.targets || {};
         setTargetsMap(loadedTargets);
         
         setTarget(loadedTargets[selectedMonth] || { packets: 2224, litres: +(2224/loadedConfig.packets_per_litre).toFixed(2) });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, trackerRef.path);
    });

    // Logs subcollection listener (Filtered by selectedMonth)
    const logsRef = collection(db, 'trackers', authToken, 'logs');
    const filteredLogsQuery = query(
      logsRef, 
      where("date", ">=", `${selectedMonth}-01`), 
      where("date", "<=", `${selectedMonth}-31`)
    );
    
    const unsubscribeLogs = onSnapshot(filteredLogsQuery, (snapshot) => {
      const loadedLogs: LogData[] = [];
      snapshot.forEach(doc => loadedLogs.push(doc.data() as LogData));
      setLogs(loadedLogs);
      setIsDataLoaded(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, logsRef.path);
    });

    return () => {
      unsubscribeTracker();
      unsubscribeLogs();
    };
  }, [isAuthenticated, authToken, selectedMonth]);

  const saveToFirebase = async (updates: Partial<{ targets: any, config: any }>) => {
    if (!isAuthenticated || !authToken) return;
    const trackerRef = doc(db, 'trackers', authToken);
    try {
      const updatesObj: any = {};
      if (updates.targets !== undefined) updatesObj.targets = updates.targets;
      if (updates.config !== undefined) updatesObj.config = updates.config;
      
      if (Object.keys(updatesObj).length > 0) {
        await setDoc(trackerRef, updatesObj, { merge: true });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, trackerRef.path);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setAuthError("");
    
    // Simulate network delay
    await new Promise(r => setTimeout(r, 600));
    
    // Hash password to avoid hardcoding plaintext in client-side code
    const msgBuffer = new TextEncoder().encode(password.trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    if (hashHex === "586a306a920b7aa6e8c6f6ccd28c76408294dcc2144572feac191dcd1b5db02a") {
      try {
        await signInAnonymously(auth);
        setAuthToken(hashHex);
        setIsAuthenticated(true);
      } catch (err: any) {
        setAuthError("Could not sign in successfully. Ensure Anonymous auth is enabled.");
      }
    } else {
      setAuthError("Incorrect password");
    }
    setIsAuthenticating(false);
  };
  
  // States
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [tempTarget, setTempTarget] = useState<string>("");
  const [targetUnit, setTargetUnit] = useState<"packets" | "litres">("packets");
  
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [tempConfigPpl, setTempConfigPpl] = useState<string>("13");
  const [tempConfigVpp, setTempConfigVpp] = useState<string>("48000");

  // Log Entry
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logDate, setLogDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [logCity, setLogCity] = useState<string>("Ho Chi Minh City");
  const [logPackets, setLogPackets] = useState<string>("");
  const [logLitres, setLogLitres] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTarget(targetsMap[selectedMonth] || { packets: 2224, litres: +(2224/config.packets_per_litre).toFixed(2) });
  }, [selectedMonth, targetsMap, config.packets_per_litre]);

  const handleUpdateTarget = () => {
    let packets = targetUnit === "packets" ? parseFloat(tempTarget) : parseFloat(tempTarget) * config.packets_per_litre;
    if (isNaN(packets)) return;
    
    const newTargets = { ...targetsMap, [selectedMonth]: { packets: Math.round(packets), litres: +(Math.round(packets)/config.packets_per_litre).toFixed(2) } };
    
    saveToFirebase({ targets: newTargets });
    setIsEditingTarget(false);
  };

  const handleUpdateConfig = () => {
    const ppl = parseFloat(tempConfigPpl);
    const vpp = parseFloat(tempConfigVpp);
    if (isNaN(ppl) || isNaN(vpp)) return;
    
    const newConfig = { packets_per_litre: ppl, vnd_per_packet: vpp };
    saveToFirebase({ config: newConfig });
    setIsEditingConfig(false);
  };

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    let packets = parseFloat(logPackets);
    if (isNaN(packets) || !logDate) return;
    setIsSubmitting(true);
    
    await new Promise(r => setTimeout(r, 400));
    
    const logId = editingLogId || (Date.now().toString() + Math.random().toString().replace('.', ''));
    
    const newLog = {
      id: logId,
      date: logDate,
      city: logCity,
      packets: Math.round(packets),
      litres: +(Math.round(packets) / config.packets_per_litre).toFixed(2),
      revenue: Math.round(packets) * config.vnd_per_packet
    };
    
    if (isAuthenticated && authToken) {
      try {
        const logRef = doc(db, 'trackers', authToken, 'logs', logId);
        await setDoc(logRef, newLog, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `trackers/${authToken}/logs/${logId}`);
      }
    }
    
    setEditingLogId(null);
    setLogPackets("");
    setLogLitres("");
    setIsSubmitting(false);
  };

  const handleDeleteLog = async (id: string) => {
    if (!id || !isAuthenticated || !authToken) return;
    try {
      const logRef = doc(db, 'trackers', authToken, 'logs', id);
      await deleteDoc(logRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `trackers/${authToken}/logs/${id}`);
    }
  };

  const handleEditLog = (log: LogData) => {
    if (!log.id) return;
    setEditingLogId(log.id);
    setLogDate(log.date);
    setLogCity(log.city);
    setLogPackets(log.packets.toString());
    setLogLitres(+(log.packets / config.packets_per_litre).toFixed(2).toString());
    // Scroll to the form
    reportRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const handlePacketsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLogPackets(e.target.value);
    if (e.target.value !== "") {
      setLogLitres((parseFloat(e.target.value) / config.packets_per_litre).toFixed(2));
    } else {
      setLogLitres("");
    }
  };

  const handleLitresChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLogLitres(e.target.value);
    if (e.target.value !== "") {
      setLogPackets((parseFloat(e.target.value) * config.packets_per_litre).toFixed(0));
    } else {
      setLogPackets("");
    }
  };

  // Computations
  const filteredLogs = useMemo(() => {
    let filtered = logs;
    if (selectedMonth) {
      filtered = filtered.filter(log => log.date.startsWith(selectedMonth));
    }
    if (selectedCityFilter !== "All") {
      filtered = filtered.filter(log => log.city === selectedCityFilter);
    }
    return filtered;
  }, [logs, selectedMonth, selectedCityFilter]);

  const totalPackets = filteredLogs.reduce((sum, log) => sum + log.packets, 0);
  const totalLitres = filteredLogs.reduce((sum, log) => sum + log.litres, 0);
  const totalRevenue = filteredLogs.reduce((sum, log) => sum + log.revenue, 0);
  
  // Calculate remaining from overall or filtered? Let's assume the target applies to the selected timeline/month
  const remainingPackets = Math.max(target.packets - totalPackets, 0);
  const remainingLitres = Math.max(target.litres - totalLitres, 0);
  const progressPercent = Math.min((totalPackets / target.packets) * 100 || 0, 100);

  // Chart data formatting
  const chartData = useMemo(() => {
    if (!selectedMonth) return [];
    // Generate all days in the selected month
    const [year, month] = selectedMonth.split("-").map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = endOfMonth(startDate);
    const data = [];
    
    // Group logs by date (sum everything up if All cities is selected)
    const logsMap = new Map();
    filteredLogs.forEach(log => {
      const existing = logsMap.get(log.date) || { packets: 0, litres: 0 };
      logsMap.set(log.date, { 
        packets: existing.packets + log.packets, 
        litres: existing.litres + log.litres 
      });
    });

    for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
        const dStr = format(d, "yyyy-MM-dd");
        const log = logsMap.get(dStr);
        data.push({
            date: format(d, "MMM dd"),
            originalDate: dStr,
            packets: log ? log.packets : 0,
            litres: log ? log.litres : 0,
        });
    }
    return data;
  }, [filteredLogs, selectedMonth]);

  // Export to PDF
  const exportPDF = async () => {
    if (!reportRef.current) return;
    try {
      const eleWidth = reportRef.current.scrollWidth;
      const eleHeight = reportRef.current.scrollHeight;
      
      const imgData = await toPng(reportRef.current, { 
        backgroundColor: '#000000',
        pixelRatio: 2,
        width: eleWidth,
        height: eleHeight,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
          width: eleWidth + 'px',
          height: eleHeight + 'px'
        }
      });
      
      const pdf = new jsPDF({
        orientation: eleWidth > eleHeight ? 'l' : 'p',
        unit: 'px',
        format: [document.documentElement.clientWidth > eleWidth ? document.documentElement.clientWidth : eleWidth, eleHeight]
      });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      pdf.setFillColor('#000000');
      pdf.rect(0, 0, pdfWidth, pdfHeight, 'F');
      
      pdf.addImage(imgData, 'PNG', 0, 0, eleWidth, eleHeight);
      pdf.save(`Chef-Pilah-Tracker-${selectedMonth}.pdf`);
    } catch (e) {
      console.error("PDF export failed", e);
    }
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!isAuthenticated || !authToken) return;
    setIsRefreshing(true);
    // onSnapshot handles real-time sync, just give visual feedback
    await new Promise(r => setTimeout(r, 600));
    setIsRefreshing(false);
  };

  const exportCSV = () => {
    if (filteredLogs.length === 0) return;
    const headers = ["Date,City,Packets,Litres,Revenue (VND)"];
    const sortedLogs = [...filteredLogs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const csvRows = sortedLogs.map(log => `${log.date},${log.city},${log.packets},${log.litres},${log.revenue}`);
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(headers.concat(csvRows).join("\n"));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", csvContent);
    downloadAnchorNode.setAttribute("download", `Chef-Pilah-Tracker-${selectedMonth}.csv`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  if (!isAuthenticated) {
    return (
      <div className="relative h-screen w-full flex flex-col items-center justify-center font-sans overflow-hidden bg-[#110300]">
        <style>
          {`
            @keyframes simmerBubble {
              0% { transform: translateY(0) scale(0.6); opacity: 0; }
              10% { opacity: 1; transform: translateY(-5vh) scale(1); }
              90% { opacity: 0.8; }
              100% { transform: translateY(-100vh) scale(1.2); opacity: 0; }
            }
            @keyframes floatSpice {
              0% { transform: translateX(-15px) rotate(-10deg); }
              100% { transform: translateX(15px) rotate(20deg); }
            }
            .pure-bubble {
              border: 1px solid rgba(255, 180, 50, 0.4);
              background: linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 60%);
              border-radius: 50%;
              box-shadow: 0 4px 8px rgba(200, 50, 0, 0.3);
            }
            .oil-drop {
              background: radial-gradient(circle at 35% 35%, rgba(255, 100, 0, 0.7) 0%, rgba(200, 30, 0, 0.1) 70%);
              border-radius: 50%;
              box-shadow: inset -3px -3px 8px rgba(150, 20, 0, 0.5), 0 4px 10px rgba(0,0,0,0.2);
            }
          `}
        </style>

        <TomYumBackground />

        <div className="relative z-10 w-full max-w-sm px-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-[#FF6321] to-[#8A1C00] rounded-full flex items-center justify-center border-4 border-[#FFC300]/30 shadow-[0_0_40px_rgba(255,99,33,0.4)] backdrop-blur-sm relative overflow-hidden">
               <div className="absolute inset-0 bg-black/20 mix-blend-overlay"></div>
               <Lock className="w-8 h-8 text-[#FFC300] relative z-10" />
            </div>
          </div>
          
          <div className="text-center mb-10">
            <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#FFC300] via-[#FF8A00] to-[#FFC300] tracking-tight mb-2 drop-shadow-sm font-serif">
              CHEF PILAH
            </h1>
            <h2 className="text-xl font-bold text-white tracking-widest uppercase mb-1 drop-shadow-md">
              Tomyum <span className="font-light">Fast & Easy</span>
            </h2>
            <p className="text-xs text-[#FFC300]/70 uppercase tracking-widest font-medium">Daily Tracker / Secured</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="relative group">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password..."
                className="w-full bg-[#2A0800]/60 backdrop-blur-xl border border-[#FF5A00]/40 rounded-xl px-4 py-4 text-center text-lg text-[#FFC300] font-mono tracking-[0.2em] focus:outline-none focus:border-[#FF8A00] focus:ring-2 focus:ring-[#FF8A00]/50 placeholder:text-[#FF8A00]/40 placeholder:tracking-normal transition-all shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] pr-12"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#FF8A00]/50 hover:text-[#FFC300] transition-colors"
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            
            {authError && (
              <div className="text-[#FFC300] text-xs text-center font-medium animate-in fade-in bg-black/40 rounded py-1 px-2 border border-[#FFC300]/20 backdrop-blur-md">
                {authError}
              </div>
            )}

            <button 
              type="submit" 
              disabled={isAuthenticating || !password}
              className="w-full relative overflow-hidden bg-gradient-to-b from-[#FF7A00] to-[#DF3E00] hover:from-[#FF8F22] hover:to-[#FF5A00] text-white py-4 rounded-xl font-bold tracking-[0.15em] text-sm uppercase transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group shadow-[0_4px_0_#9A1C00,0_8px_20px_rgba(223,62,0,0.4)] active:translate-y-[4px] active:shadow-[0_0px_0_#9A1C00,0_4px_10px_rgba(223,62,0,0.4)] border border-[#FFB380]/40"
            >
              <div className="absolute inset-0 bg-[linear-gradient(to_right,transparent,rgba(255,255,255,0.3),transparent)] -translate-x-[150%] skew-x-[-20deg] group-hover:translate-x-[150%] transition-transform duration-700 ease-out"></div>
              {isAuthenticating ? <Loader2 className="w-5 h-5 animate-spin relative z-10" /> : <span className="relative z-10 drop-shadow-[0_2px_2px_rgba(0,0,0,0.3)]">Unlock Workspace</span>}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen w-full bg-[#000000] text-[#FFFFFF] font-sans lg:overflow-hidden overflow-y-auto" ref={reportRef}>
      
      {/* LEFT SIDEBAR: TARGETS & CONFIGURATION */}
      <aside className="w-full lg:w-80 border-b lg:border-b-0 lg:border-r border-zinc-800 p-6 lg:p-8 flex flex-col shrink-0 lg:overflow-y-auto">
        <div className="mb-10 lg:mb-10">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 bg-[#FF6321] rounded-full"></div>
            <h1 className="text-xs tracking-[0.2em] font-semibold text-zinc-400 uppercase">Chef Pilah</h1>
          </div>
          <h2 className="text-xl font-light tracking-tight text-white">Daily Tracker</h2>
        </div>

        <div className="flex-1 space-y-8">
          {/* TARGET CONFIGURATION CARD */}
          <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-xl">
            <div className="flex justify-between items-start mb-6">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Current Target</span>
              {!isEditingTarget ? (
                 <button onClick={() => { setTempTarget(target.packets.toString()); setIsEditingTarget(true); }} className="text-[#FF6321] text-xs font-medium hover:underline flex items-center gap-1">
                    Edit
                 </button>
              ) : (
                 <button onClick={() => setIsEditingTarget(false)} className="text-zinc-400 hover:text-white text-xs font-medium">
                    Cancel
                 </button>
              )}
            </div>

            {isEditingTarget ? (
              <div className="space-y-4 mb-2 animate-in fade-in zoom-in-95 duration-200">
                <div>
                  <div className="flex gap-2 mb-2">
                     <button onClick={() => setTargetUnit("packets")} className={cn("flex-1 py-1 text-xs uppercase tracking-wider font-bold rounded border", targetUnit === "packets" ? "bg-[#FF6321]/20 border-[#FF6321] text-[#FF6321]" : "bg-transparent border-zinc-800 text-zinc-500 hover:text-white transition-colors")}>Packets</button>
                     <button onClick={() => setTargetUnit("litres")} className={cn("flex-1 py-1 text-xs uppercase tracking-wider font-bold rounded border", targetUnit === "litres" ? "bg-[#FF6321]/20 border-[#FF6321] text-[#FF6321]" : "bg-transparent border-zinc-800 text-zinc-500 hover:text-white transition-colors")}>Litres</button>
                  </div>
                  <input 
                    type="number" 
                    value={tempTarget} 
                    onChange={(e) => setTempTarget(e.target.value)} 
                    className="w-full bg-black border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#FF6321] text-sm tabular-nums"
                  />
                </div>
                <button onClick={handleUpdateTarget} className="w-full bg-[#FF6321] hover:bg-[#e5581e] text-white py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 tracking-wider">
                  SAVE target
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-3xl font-light tabular-nums">{target.packets.toLocaleString()}</div>
                  <div className="text-xs text-zinc-400">Packets (Target)</div>
                </div>
                <div className="h-px bg-zinc-800 w-full"></div>
                <div>
                  <div className="text-3xl font-light tabular-nums">{target.litres}</div>
                  <div className="text-xs text-zinc-400">Litres (Target)</div>
                </div>
              </div>
            )}
            
            <div className="mt-6 pt-4 border-t border-zinc-800">
              <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-2">
                <span className="uppercase tracking-widest font-bold">Conversion Rules</span>
                {!isEditingConfig ? (
                  <button onClick={() => { setTempConfigPpl(config.packets_per_litre.toString()); setTempConfigVpp(config.vnd_per_packet.toString()); setIsEditingConfig(true); }} className="text-[#FF6321] text-[10px] font-medium hover:underline">
                    Edit
                  </button>
                ) : (
                  <button onClick={() => setIsEditingConfig(false)} className="text-zinc-400 hover:text-white text-[10px] font-medium">
                    Cancel
                  </button>
                )}
              </div>
              
              {isEditingConfig ? (
                <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200 mt-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] text-zinc-500 mb-1">PKT per LTR</label>
                      <input 
                        type="number" 
                        value={tempConfigPpl} 
                        onChange={(e) => setTempConfigPpl(e.target.value)} 
                        className="w-full bg-black border border-zinc-800 rounded px-2 py-1.5 text-white focus:outline-none focus:border-[#FF6321] text-xs tabular-nums"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] text-zinc-500 mb-1">VND per PKT</label>
                      <input 
                        type="number" 
                        value={tempConfigVpp} 
                        onChange={(e) => setTempConfigVpp(e.target.value)} 
                        className="w-full bg-black border border-zinc-800 rounded px-2 py-1.5 text-white focus:outline-none focus:border-[#FF6321] text-xs tabular-nums"
                      />
                    </div>
                  </div>
                  <button onClick={handleUpdateConfig} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-1.5 rounded text-[10px] font-bold transition flex items-center justify-center tracking-wider">
                    SAVE RULES
                  </button>
                </div>
              ) : (
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>{config.packets_per_litre} PKT = 1 LTR</span>
                  <span>1 PKT = {(config.vnd_per_packet / 1000).toFixed(0)}K VND</span>
                </div>
              )}
            </div>
          </div>

          {/* PROGRESS OVERVIEW */}
          <div className="space-y-4">
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Progress Overview</span>
            <div className="bg-[#FF6321]/10 border border-[#FF6321]/20 p-5 rounded-xl">
              <div className="text-2xl font-semibold text-[#FF6321] tabular-nums">{remainingPackets.toLocaleString()}</div>
              <div className="text-[11px] text-[#FF6321]/80 mt-0.5">Packets Remaining</div>
              <div className="w-full bg-zinc-800 h-1 mt-4 rounded-full overflow-hidden">
                <div className="bg-[#FF6321] h-full transition-all duration-1000 ease-out" style={{ width: `${progressPercent}%` }}></div>
              </div>
            </div>
            
            {remainingLitres > 0 && (
              <div className="flex justify-between items-center bg-zinc-900 border border-zinc-800 rounded-lg p-3 px-4">
                <span className="text-xs text-zinc-400">Litres remaining</span>
                <span className="text-sm font-mono font-medium text-white">{remainingLitres.toFixed(1)} L</span>
              </div>
            )}
          </div>
        </div>

        {/* EXPORT BUTTONS */}
        <div className="mt-8 lg:mt-auto space-y-2">
          <button onClick={exportPDF} className="w-full py-3.5 bg-[#FFFFFF] text-[#000000] rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2">
            <FileDown className="w-4 h-4" />
            Generate PDF
          </button>
          <button onClick={exportCSV} className="w-full py-3.5 bg-zinc-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-zinc-700 border border-zinc-700 transition-colors flex items-center justify-center gap-2">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </aside>

      {/* RIGHT PANEL: ANALYTICS & LOGGING */}
      <main className="flex-1 flex flex-col p-6 lg:p-8 lg:overflow-y-auto">
        
        {/* SUMMARY STATS HEADER */}
        <header className="flex flex-col xl:flex-row justify-between xl:items-end mb-8 gap-6">
          <div className="flex flex-wrap gap-6 xl:gap-8">
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{format(parseISO(selectedMonth + "-01"), "MMM yyyy")} Total</p>
              <p className="text-2xl font-light tabular-nums">{totalPackets.toLocaleString()} <span className="text-xs text-zinc-500 font-sans tracking-normal">PKT</span></p>
            </div>
            <div className="w-px h-10 bg-zinc-800 hidden sm:block"></div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Consumption Vol</p>
              <p className="text-2xl font-light tabular-nums">{totalLitres.toFixed(2)} <span className="text-xs text-zinc-500 font-sans tracking-normal">LTR</span></p>
            </div>
            <div className="w-px h-10 bg-zinc-800 hidden sm:block"></div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Current Cost</p>
              <p className="text-2xl font-light tabular-nums">{totalRevenue >= 1000000 ? (totalRevenue / 1000000).toFixed(1) + "M" : totalRevenue >= 1000 ? (totalRevenue / 1000).toFixed(0) + "K" : totalRevenue} <span className="text-xs text-[#FF6321] uppercase font-bold tracking-normal">VND</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-zinc-900 rounded-lg p-1 w-full xl:w-auto h-min">
             <button 
               onClick={handleRefresh}
               className="bg-zinc-800 text-white rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#FF6321] text-[11px] font-bold tracking-wider hover:bg-zinc-700 transition-colors flex items-center justify-center shrink-0"
               title="Refresh Data"
             >
               <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
             </button>
             <select
              value={selectedCityFilter}
              onChange={(e) => setSelectedCityFilter(e.target.value)}
              className="bg-zinc-800 text-white rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#FF6321] text-[11px] font-bold tracking-wider w-full text-center xl:text-left cursor-pointer"
             >
              <option value="All">ALL CITIES</option>
              {VIETNAM_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
             </select>
             <input 
              type="month" 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-zinc-800 text-white rounded-md px-4 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#FF6321] text-[11px] font-bold uppercase tracking-wider w-full text-center xl:text-left cursor-text"
            />
          </div>
        </header>

        {/* COMBO CHART AREA */}
        <section className="flex-1 bg-zinc-900/30 border border-zinc-800 rounded-2xl p-6 lg:p-8 mb-8 min-h-[350px] w-full max-w-full overflow-hidden flex flex-col">
          <div className="flex gap-4 items-center mb-6 shrink-0">
            <div className="flex items-center gap-2"><span className="w-3 h-3 bg-[#FF6321] rounded-sm"></span><span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Packets</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-[2px] bg-white"></span><span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Litres</span></div>
          </div>
          
          <div className="w-full flex-1 relative min-h-[250px]">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" stroke="#27272a" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="#52525b" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={{ stroke: '#27272a', strokeWidth: 2 }}
                  minTickGap={20}
                  tickMargin={12}
                  fontFamily="mono"
                  tickFormatter={(val) => val.toUpperCase()}
                />
                <YAxis 
                  yAxisId="left" 
                  stroke="#52525b" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                  tickMargin={10}
                />
                <YAxis 
                  yAxisId="right" 
                  orientation="right" 
                  stroke="#52525b" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                  tickMargin={10}
                />
                <Tooltip 
                  cursor={{ fill: '#27272a', opacity: 0.4 }}
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                  itemStyle={{ color: '#fff' }}
                  labelStyle={{ color: '#a1a1aa', marginBottom: '4px', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.05em' }}
                />
                <Bar yAxisId="left" dataKey="packets" name="Packets" fill="#FF6321" radius={[2, 2, 0, 0]} maxBarSize={30} opacity={0.85} />
                <Line yAxisId="right" type="monotone" dataKey="litres" name="Litres" stroke="#FFFFFF" strokeWidth={2.5} dot={{ r: 3, fill: '#FFFFFF', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#FFFFFF' }} />
              </ComposedChart>
            </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* LOGGING INTERFACE */}
        <footer className="grid grid-cols-1 xl:grid-cols-12 gap-6 min-h-[160px]">
          {/* Form */}
          <form onSubmit={handleAddLog} className="xl:col-span-4 bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between">
            <div className="mb-4 xl:mb-0">
              <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-3 block flex items-center gap-2"><Plus className="w-3 h-3"/> Log Daily Usage</label>
              
              <div className="flex flex-col sm:flex-row gap-3 mb-3">
                <input 
                  type="date" 
                  required
                  value={logDate}
                  onChange={e => setLogDate(e.target.value)}
                  className="w-full sm:flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FF6321] min-w-0"
                />
                <select
                  value={logCity}
                  onChange={e => setLogCity(e.target.value)}
                  className="w-full sm:flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FF6321] min-w-0 truncate"
                >
                  {VIETNAM_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="w-full sm:flex-1 relative min-w-0">
                  <input 
                    type="number" 
                    step="any"
                    required
                    value={logPackets}
                    onChange={handlePacketsChange}
                    placeholder="Packets" 
                    className="w-full bg-black border border-zinc-800 rounded-lg pl-3 pr-10 py-2 text-sm text-white focus:outline-none focus:border-[#FF6321]"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-500 pointer-events-none">PKT</span>
                </div>
                <div className="w-full sm:flex-1 relative min-w-0">
                  <input 
                    type="number" 
                    step="any"
                    required
                    value={logLitres}
                    onChange={handleLitresChange}
                    placeholder="Litres" 
                    className="w-full bg-black border border-zinc-800 rounded-lg pl-3 pr-10 py-2 text-sm text-white focus:outline-none focus:border-[#FF6321]"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-zinc-500 pointer-events-none">LTR</span>
                </div>
              </div>
            </div>
            <div className="mt-4 xl:mt-0 flex flex-col gap-2 w-full">
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full bg-[#FF6321] hover:bg-[#e5581e] text-white py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Saving..." : editingLogId ? "Save Edit" : "Submit Log"}
              </button>
              {editingLogId && (
                <button 
                  type="button" 
                  onClick={() => {
                    setEditingLogId(null);
                    setLogPackets("");
                    setLogLitres("");
                  }}
                  className="w-full bg-transparent border border-zinc-800 hover:bg-zinc-800 text-zinc-400 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {/* Recent Logs List */}
          <div className="xl:col-span-8 bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Recent Logs</label>
              <span className="text-[10px] text-zinc-500">Showing all {selectedMonth ? format(parseISO(selectedMonth + "-01"), "MMM yyyy") : ""} entries</span>
            </div>
            
            <div className="space-y-3 overflow-y-auto flex-1 pr-2 custom-scrollbar">
              {filteredLogs.length === 0 ? (
                <div className="text-sm text-zinc-600 text-center py-4">No logs recorded for this month.</div>
              ) : (
                [...filteredLogs].reverse().map((log, i) => (
                   <div key={i} className="flex justify-between items-center text-xs border-b border-zinc-800/50 pb-2 last:border-0 last:pb-0 group hover:bg-zinc-800/50 rounded px-2 -mx-2 transition-colors">
                    <span className="text-zinc-400 w-24 shrink-0">{format(parseISO(log.date), "MMM dd, yyyy")}</span>
                    <span className="text-zinc-500 w-32 shrink-0 truncate">{log.city}</span>
                    <span className="font-mono flex-1 text-right sm:text-center truncate pr-2">
                        <span className="text-white">+{log.packets} PKT</span> 
                        <span className="text-zinc-600 ml-2 hidden sm:inline">{log.litres.toFixed(2)} LTR</span>
                    </span>
                    <div className="flex items-center justify-end gap-1 w-20 shrink-0">
                      <button type="button" onClick={() => handleEditLog(log)} className="text-zinc-600 hover:text-[#FF6321] transition-colors p-1" title="Edit Log">
                        <PencilLine className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => log.id && handleDeleteLog(log.id)} className="text-zinc-600 hover:text-red-500 transition-colors p-1" title="Delete Log">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </footer>

      </main>
    </div>
  );
}
