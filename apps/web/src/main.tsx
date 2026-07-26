import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { queryClient } from './lib/queryClient.ts';
import { AuthProvider } from './lib/auth.tsx';
import { ProtectedRoute } from './routes/ProtectedRoute.tsx';
import { Login } from './pages/Login.tsx';
import { CompleteProfile } from './pages/CompleteProfile.tsx';
import { Settings } from './pages/Settings.tsx';
import { StudentDashboard } from './pages/dashboards/StudentDashboard.tsx';
import { UniversityDashboard } from './pages/dashboards/UniversityDashboard.tsx';
import { CompanyDashboard } from './pages/dashboards/CompanyDashboard.tsx';
import { RecruiterDashboard } from './pages/dashboards/RecruiterDashboard.tsx';
import { AdminDashboard } from './pages/dashboards/AdminDashboard.tsx';
import { CompanyDrives } from './pages/drives/CompanyDrives.tsx';
import { CreateDrive } from './pages/drives/CreateDrive.tsx';
import { CompanyDriveDetail } from './pages/drives/CompanyDriveDetail.tsx';
import { StudentDrives } from './pages/drives/StudentDrives.tsx';
import { StudentDriveDetail } from './pages/drives/StudentDriveDetail.tsx';
import { MyApplications } from './pages/drives/MyApplications.tsx';
import { UniversityDrives } from './pages/drives/UniversityDrives.tsx';
import { Inbox } from './pages/mail/Inbox.tsx';
import { Sent } from './pages/mail/Sent.tsx';
import { Compose } from './pages/mail/Compose.tsx';
import { MailDetail } from './pages/mail/MailDetail.tsx';
import { Problems } from './pages/arena/Problems.tsx';
import { Workspace } from './pages/arena/Workspace.tsx';
import { Contests } from './pages/contests/Contests.tsx';
import { CreateContest } from './pages/contests/CreateContest.tsx';
import { ContestDetail } from './pages/contests/ContestDetail.tsx';
import { ContestArena } from './pages/contests/ContestArena.tsx';
import { Leaderboard } from './pages/contests/Leaderboard.tsx';
import { Webinars } from './pages/webinars/Webinars.tsx';
import { CreateWebinar } from './pages/webinars/CreateWebinar.tsx';
import { WebinarConsole } from './pages/webinars/WebinarConsole.tsx';
import { Interviews } from './pages/interviews/Interviews.tsx';
import { ScheduleInterview } from './pages/interviews/ScheduleInterview.tsx';
import { InterviewRoom } from './pages/interviews/InterviewRoom.tsx';
import { Recordings } from './pages/recordings/Recordings.tsx';
import { RecordingPlayer } from './pages/recordings/RecordingPlayer.tsx';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<App />} />
            <Route path="/login" element={<Login />} />
            <Route path="/complete-profile" element={<CompleteProfile />} />

            {/* Authenticated app */}
            <Route
              path="/app/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/student"
              element={
                <ProtectedRoute role="STUDENT">
                  <StudentDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/university"
              element={
                <ProtectedRoute role="UNIVERSITY">
                  <UniversityDashboard />
                </ProtectedRoute>
              }
            />

            {/* Phase 4 — Student drives & applications */}
            <Route
              path="/app/student/drives"
              element={
                <ProtectedRoute role="STUDENT">
                  <StudentDrives />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/student/drives/:publicId"
              element={
                <ProtectedRoute role="STUDENT">
                  <StudentDriveDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/student/applications"
              element={
                <ProtectedRoute role="STUDENT">
                  <MyApplications />
                </ProtectedRoute>
              }
            />

            {/* Phase 4 — Company drives */}
            <Route
              path="/app/company/drives"
              element={
                <ProtectedRoute role="COMPANY">
                  <CompanyDrives />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/company/drives/new"
              element={
                <ProtectedRoute role="COMPANY">
                  <CreateDrive />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/company/drives/:publicId"
              element={
                <ProtectedRoute role="COMPANY">
                  <CompanyDriveDetail />
                </ProtectedRoute>
              }
            />

            {/* Phase 4 — University drives & placement tracking */}
            <Route
              path="/app/university/drives"
              element={
                <ProtectedRoute role="UNIVERSITY">
                  <UniversityDrives />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/company"
              element={
                <ProtectedRoute role="COMPANY">
                  <CompanyDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/recruiter"
              element={
                <ProtectedRoute role="RECRUITER">
                  <RecruiterDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/admin"
              element={
                <ProtectedRoute role="ADMIN">
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            {/* Phase 5 — Internal mail (available to every role) */}
            <Route
              path="/app/mail"
              element={
                <ProtectedRoute>
                  <Inbox />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/mail/sent"
              element={
                <ProtectedRoute>
                  <Sent />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/mail/compose"
              element={
                <ProtectedRoute>
                  <Compose />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/mail/:publicId"
              element={
                <ProtectedRoute>
                  <MailDetail />
                </ProtectedRoute>
              }
            />

            {/* Phase 6 — Code Arena (student-facing) */}
            <Route
              path="/app/arena"
              element={
                <ProtectedRoute role="STUDENT">
                  <Problems />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/arena/:slug"
              element={
                <ProtectedRoute role="STUDENT">
                  <Workspace />
                </ProtectedRoute>
              }
            />

            {/* Phase 7 — Contests (multi-role; server authorizes) */}
            <Route
              path="/app/contests"
              element={
                <ProtectedRoute>
                  <Contests />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/contests/new"
              element={
                <ProtectedRoute>
                  <CreateContest />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/contests/:publicId"
              element={
                <ProtectedRoute>
                  <ContestDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/contests/:publicId/arena"
              element={
                <ProtectedRoute role="STUDENT">
                  <ContestArena />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/contests/:publicId/leaderboard"
              element={
                <ProtectedRoute>
                  <Leaderboard />
                </ProtectedRoute>
              }
            />

            {/* Phase 8 — Webinars (multi-role; server authorizes; console dispatches to room) */}
            <Route
              path="/app/webinars"
              element={
                <ProtectedRoute>
                  <Webinars />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/webinars/new"
              element={
                <ProtectedRoute>
                  <CreateWebinar />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/webinars/:publicId"
              element={
                <ProtectedRoute>
                  <WebinarConsole />
                </ProtectedRoute>
              }
            />

            {/* Phase 9 — Interviews (multi-role; server authorizes; room dispatches by status) */}
            <Route
              path="/app/interviews"
              element={
                <ProtectedRoute>
                  <Interviews />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/interviews/new"
              element={
                <ProtectedRoute>
                  <ScheduleInterview />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/interviews/:publicId"
              element={
                <ProtectedRoute>
                  <InterviewRoom />
                </ProtectedRoute>
              }
            />

            {/* Phase 10 — Interview recordings (server scopes visibility per role) */}
            <Route
              path="/app/recordings"
              element={
                <ProtectedRoute>
                  <Recordings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/recordings/:publicId"
              element={
                <ProtectedRoute>
                  <RecordingPlayer />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
