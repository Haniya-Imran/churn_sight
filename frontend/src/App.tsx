import { Link, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { LandingPage } from "./pages/LandingPage";
import { ModelPage } from "./pages/ModelPage";
import { PredictPage } from "./pages/PredictPage";

function NotFound() {
  return (
    <div className="container page">
      <div className="glass panel" style={{ maxWidth: 560 }}>
        <h1>Page not found</h1>
        <p className="muted">That page doesn't exist.</p>
        <Link to="/" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
          Back to home
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/predict" element={<PredictPage />} />
        <Route path="/model" element={<ModelPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
