/**
 * Chip Client — Automation Studio Container
 * Project selection and blank project workspace.
 */

import React, { useEffect, useState } from 'react'
import { circuitStore } from './store'
import { createProjectApi, deleteProjectApi, listProjectsApi } from './api'
import { CleanDropdown, type DropdownOption } from '../components/CleanDropdown'

interface AutomationStudioProps {
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

function getProjectIdFromHash(): string {
  const match = window.location.hash.match(/^#\/automation\/project\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

export const AutomationStudio: React.FC<AutomationStudioProps> = ({
  projectId: initialProjectId = '',
  className = '',
}) => {
  const [currentPid, setCurrentPid] = useState(initialProjectId || getProjectIdFromHash())
  const [openedProjectId, setOpenedProjectId] = useState(initialProjectId || getProjectIdFromHash())
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectItem | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
    setProjectsLoading(true)
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
      setProjects([])
    } finally {
      setProjectsLoading(false)
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

  const activeProject = projects.find((p) => p.projectId === currentPid)

  const openProject = (projectId: string) => {
    setCurrentPid(projectId)
    setOpenedProjectId(projectId)
    window.history.pushState({}, '', `#/automation/project/${encodeURIComponent(projectId)}`)
  }

  const handleCreateProject = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!projectName.trim()) return
    setCreatingProject(true)
    setCreateError(null)
    try {
      const result = await createProjectApi({
        name: projectName.trim(),
        description: projectDescription.trim(),
      })
      if (!result.success || !result.project) throw new Error('Unable to create project.')
      setProjects((previous) => [
        {
          projectId: result.project.projectId,
          name: result.project.name,
          description: result.project.description,
          mcu: result.project.mcu,
          currentVersion: 0,
          hasCircuit: false,
          updatedAt: result.project.updatedAt,
        },
        ...previous,
      ])
      setProjectName('')
      setProjectDescription('')
      setShowCreateProject(false)
      openProject(result.project.projectId)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to create project.')
    } finally {
      setCreatingProject(false)
    }
  }

  const handleDeleteProject = async (project: ProjectItem) => {
    setDeleteError(null)
    setDeletingProjectId(project.projectId)
    try {
      const result = await deleteProjectApi(project.projectId)
      if (!result.success) throw new Error(result.message || 'Unable to delete project.')

      const remaining = projects.filter((item) => item.projectId !== project.projectId)
      setProjects(remaining)
      if (openedProjectId === project.projectId) {
        setOpenedProjectId('')
        window.history.pushState({}, '', '#/automation')
      }
      if (currentPid === project.projectId) {
        setCurrentPid(remaining[0]?.projectId || '')
        if (remaining.length === 0) circuitStore.clearProject()
      }
      setDeleteCandidate(null)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unable to delete project.')
    } finally {
      setDeletingProjectId(null)
    }
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
              type="button"
              onClick={() => {
                setCreateError(null)
                setShowCreateProject(true)
              }}
              className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create Project
            </button>

          </div>
        </div>

      </div>

      {/* ── Blank Automation Workspace ───────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 h-full relative">
          {projectsLoading ? (
            <div className="flex h-full items-center justify-center bg-slate-50/40">
              <span className="text-xs text-slate-400">Loading projects...</span>
            </div>
          ) : projects.length === 0 ? (
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
            </div>
          ) : openedProjectId ? (
            <div className="h-full w-full bg-white" aria-label="Automation workspace">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">Workspace</p>
                  <h2 className="text-sm font-semibold text-slate-800">{activeProject?.name || openedProjectId}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpenedProjectId('')
                    window.history.pushState({}, '', '#/automation')
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Projects
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full w-full items-start justify-start bg-slate-50/40 p-5">
              <div className="grid w-full max-w-xl grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3">
                {projects.map((project) => {
                  const isActive = project.projectId === currentPid
                  return (
                    <div
                      key={project.projectId}
                      onClick={() => openProject(project.projectId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') openProject(project.projectId)
                      }}
                      role="button"
                      tabIndex={0}
                      className={`group relative flex aspect-square flex-col items-center justify-center rounded-lg border bg-white p-2.5 text-center shadow-xs transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-sm ${
                        isActive ? 'border-slate-400 ring-2 ring-slate-100' : 'border-slate-200'
                      }`}
                      title={`Open ${project.name || project.projectId}`}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setDeleteError(null)
                          setDeleteCandidate(project)
                        }}
                        disabled={deletingProjectId === project.projectId}
                        aria-label={`Delete ${project.name || project.projectId}`}
                        title="Delete project"
                        className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded text-slate-300 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M10 11v6M14 11v6" />
                        </svg>
                      </button>
                      <span className="mb-1.5 grid h-9 w-9 place-items-center rounded-md bg-slate-900 text-sm font-bold text-white">
                        {(project.name || project.projectId).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="w-full truncate text-xs font-semibold text-slate-800">{project.name || project.projectId}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {deleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-sm font-bold text-slate-800">Delete project?</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Delete <span className="font-semibold text-slate-700">{deleteCandidate.name || deleteCandidate.projectId}</span>? This cannot be undone.
            </p>
            {deleteError && <p className="mt-3 rounded-md bg-rose-50 px-2.5 py-2 text-xs text-rose-700">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteCandidate(null)}
                disabled={deletingProjectId !== null}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteProject(deleteCandidate)}
                disabled={deletingProjectId !== null}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {deletingProjectId ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-xs">
          <form onSubmit={handleCreateProject} className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-sm font-bold text-slate-800">Create project</h2>
            <label className="mt-4 block text-xs font-semibold text-slate-600">
              Name
              <input
                autoFocus
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Project name"
                className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2 text-xs outline-hidden focus:border-slate-400"
              />
            </label>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Description <span className="font-normal text-slate-400">(optional)</span>
              <textarea
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                rows={2}
                className="mt-1.5 w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-xs outline-hidden focus:border-slate-400"
              />
            </label>
            {createError && <p className="mt-3 rounded-md bg-rose-50 px-2.5 py-2 text-xs text-rose-700">{createError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreateProject(false)} disabled={creatingProject} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={creatingProject || !projectName.trim()} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{creatingProject ? 'Creating...' : 'Create'}</button>
            </div>
          </form>
        </div>
      )}

    </div>
  )
}

