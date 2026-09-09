/**
 * Chip Client — Circuit Viewer & Inspector Container
 * EasyEDA-style studio panel with Project Management, Database persistence,
 * reactive CircuitStore synchronization, and WebMCP agent live updates.
 */

import React, { useEffect, useState } from 'react'
import { circuitStore } from './store'
import { listProjectsApi, createProjectApi, deleteProjectApi } from './api'
import { CleanDropdown, type DropdownOption } from '../components/CleanDropdown'

interface CircuitViewerProps {
  projectId?: string
  className?: string
}

interface ProjectItem {
  projectId: string
  name: string
  description?: string
  mcu?: string
  currentVersion: number
  hasCircuit: boolean
  updatedAt: string | null
}

export const AutomationStudio: React.FC<CircuitViewerProps> = ({
  projectId: initialProjectId = '',
  className = '',
}) => {
  const [currentPid, setCurrentPid] = useState(initialProjectId)
  const [openedProjectId, setOpenedProjectId] = useState(initialProjectId)
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [deletingProject, setDeletingProject] = useState(false)
  // Global Undo / Redo keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        circuitStore.undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault()
        circuitStore.redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Fetch projects list and auto-select first project if none selected
  const loadProjects = async () => {
    try {
      const res = await listProjectsApi()
      if (res && Array.isArray(res.projects)) {
        setProjects(res.projects)
        if (res.projects.length === 0) {
          setCurrentPid('')
          circuitStore.clearProject()
        } else if (!currentPid || !res.projects.some((p) => p.projectId === currentPid)) {
          setCurrentPid(res.projects[0].projectId)
        }
      }
    } catch {
      // Ignore
    }
  }

  useEffect(() => {
    loadProjects()
  }, [])

  // Load active project circuit on change + silent background poll
  useEffect(() => {
    if (!currentPid) {
      circuitStore.clearProject()
      return
    }
    circuitStore.setProject(currentPid)
    circuitStore.loadProjectCircuit(currentPid)
  }, [currentPid])

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProjectName.trim()) return
    setCreatingProject(true)
    try {
      const res = await createProjectApi({
        name: newProjectName.trim(),
        description: newProjectDesc.trim(),
      })
      if (res && res.success && res.project) {
        setShowNewProjectModal(false)
        setNewProjectName('')
        setNewProjectDesc('')
        await loadProjects()
        openProject(res.project.projectId)
      }
    } catch (err) {
      alert('Failed to create project: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCreatingProject(false)
    }
  }

  const handleDeleteProject = async () => {
    if (!currentPid) return
    setDeletingProject(true)
    try {
      const res = await deleteProjectApi(currentPid)
      if (res && res.success) {
        setShowDeleteModal(false)
        const remaining = projects.filter((p) => p.projectId !== currentPid)
        setProjects(remaining)
        if (remaining.length > 0) {
          setCurrentPid(remaining[0].projectId)
        } else {
          setCurrentPid('')
          circuitStore.clearProject()
        }
      } else {
        alert('Failed to delete project: ' + (res?.message || 'Unknown error'))
      }
    } catch (err) {
      alert('Failed to delete project: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setDeletingProject(false)
    }
  }

  const activeProject = projects.find((p) => p.projectId === currentPid)

  const openProject = (projectId: string) => {
    setCurrentPid(projectId)
    setOpenedProjectId(projectId)
    window.history.pushState({}, '', `#/automation/project/${encodeURIComponent(projectId)}`)
  }

  const projectOptions: DropdownOption[] = projects.map((p) => ({
    value: p.projectId,
    label: p.name || p.projectId,
  }))

  return (
    <div className={`flex flex-col h-full w-full bg-white overflow-hidden relative ${className}`}>
      {/* ── Studio Header / Action Toolbar ───────────────────────────────── */}
      <div className="automation-toolbar flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-white shrink-0">
        <div className="automation-studio-left flex items-center gap-3 min-w-0">
          <div className="automation-project-controls flex items-center gap-2 min-w-0">
            <span className="automation-studio-title text-xs font-bold text-slate-800 tracking-tight flex items-center gap-1.5">
              Automation Studio
            </span>
          </div>

          <div className="w-px h-4 bg-slate-200" />

          {/* Project Switcher */}
          <div className="automation-studio-actions flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-400">Project</span>
            <CleanDropdown
              value={currentPid}
              options={projectOptions}
              onChange={openProject}
              disabled={projects.length === 0}
              placeholder="No projects"
            />

            <button
              onClick={() => setShowNewProjectModal(true)}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-200 transition cursor-pointer"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Project
            </button>

            {currentPid && (
              <button
                onClick={() => setShowDeleteModal(true)}
                title="Delete current project"
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-md border border-rose-200 transition cursor-pointer"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            )}
          </div>
        </div>

      </div>

      {/* ── Blank Automation Workspace ───────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 h-full relative">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 bg-slate-50/50">
              <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 mb-4 shadow-xs">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-1">No Projects Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mb-5">
                Create a hardware automation project to connect sensors, triggers, logic, and displays.
              </p>
              <button
                onClick={() => setShowNewProjectModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create First Project
              </button>
            </div>
          ) : openedProjectId ? (
            <div className="h-full w-full bg-white" aria-label="Automation workspace">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Project Workspace</p>
                  <h2 className="text-sm font-bold text-slate-800">{activeProject?.name || openedProjectId}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpenedProjectId('')
                    window.history.pushState({}, '', '#/automation')
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  All Projects
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full w-full items-start justify-start bg-slate-50/40 p-6">
              <div className="grid w-full max-w-2xl grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-4">
                {projects.map((project) => {
                  const isActive = project.projectId === currentPid
                  return (
                    <button
                      key={project.projectId}
                      type="button"
                      onClick={() => openProject(project.projectId)}
                      className={`group flex aspect-square flex-col items-center justify-center rounded-xl border bg-white p-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md ${
                        isActive ? 'border-slate-400 ring-2 ring-slate-100' : 'border-slate-200'
                      }`}
                      title={`Open ${project.name || project.projectId}`}
                    >
                      <span className="mb-2 grid h-10 w-10 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-white">
                        {(project.name || project.projectId).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="w-full truncate text-xs font-semibold text-slate-800">{project.name || project.projectId}</span>
                      <span className="mt-1 text-[10px] text-slate-400">Open project</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Create New Project Modal ─────────────────────────────────────── */}
      {showNewProjectModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Create Automation Project</h3>
              <button
                onClick={() => setShowNewProjectModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Smart Plant Waterer, Weather Station"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg outline-hidden focus:border-slate-500 transition"
                />
              </div>


              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Briefly describe what this automation does..."
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg outline-hidden focus:border-slate-500 transition"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewProjectModal(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingProject || !newProjectName.trim()}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition disabled:opacity-50 cursor-pointer"
                >
                  {creatingProject ? 'Creating...' : 'Create & Open Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Project Confirmation Modal ────────────────────────────── */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-sm overflow-hidden">
            <div className="p-5">
              <div className="flex items-center gap-3 text-rose-600 mb-3">
                <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Delete Project?</h3>
                  <p className="text-[11px] text-slate-500">This action cannot be undone.</p>
                </div>
              </div>
              <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                Are you sure you want to delete <span className="font-semibold text-slate-800">"{activeProject?.name || currentPid}"</span>? All saved automation flows and components will be permanently deleted from the database.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deletingProject}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteProject}
                  disabled={deletingProject}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {deletingProject ? 'Deleting...' : 'Delete Project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const CircuitViewer = AutomationStudio
