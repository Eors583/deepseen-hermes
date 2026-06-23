from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from hermes_cli.web_auth import current_request_user

from .db import transaction
from .governance import scan_skill_content
from .runtime_adapter import apply_runtime_env, create_runtime_snapshot
from .service import service


router = APIRouter(prefix="/api/enterprise", tags=["enterprise-skills"])


def _organization_id(request: Request) -> str:
    raw = (
        request.headers.get("X-Enterprise-Organization-Id")
        or request.query_params.get("organization_id")
        or "default"
    )
    org_id = str(raw).strip() or "default"
    if not org_id.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid organization_id")
    return org_id


def _actor(request: Request) -> dict[str, Any]:
    user = current_request_user(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        service.ensure_membership(
            conn,
            str(user["id"]),
            "org_admin" if user.get("role") == "super_admin" else "member",
            organization_id,
        )
    return user


def _enterprise_role(request: Request, allowed_roles: set[str]) -> dict[str, Any]:
    user = _actor(request)
    if user.get("role") == "super_admin":
        return user
    organization_id = _organization_id(request)
    with transaction() as conn:
        role = service.organization_role(conn, str(user["id"]), organization_id)
    if role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Insufficient enterprise role")
    return user


class VisibilityRuleBody(BaseModel):
    scope_type: str = Field(default="organization")
    scope_id: str = Field(default="default")
    access_level: str = Field(default="use")


class SkillCreateBody(BaseModel):
    name: str
    content_md: str
    display_name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    business_domain: Optional[str] = None
    visibility: Optional[list[VisibilityRuleBody]] = None
    publish: bool = False


class SkillDraftBody(BaseModel):
    content_md: str
    changelog: Optional[str] = None


class SkillFileBody(BaseModel):
    path: str
    content_text: Optional[str] = None
    object_url: Optional[str] = None
    mime_type: Optional[str] = None
    file_kind: str = "reference"


class VisibilityRulesBody(BaseModel):
    rules: list[VisibilityRuleBody]


class RollbackBody(BaseModel):
    target_version_id: str


class RuntimeSnapshotBody(BaseModel):
    session_id: str
    profile_id: Optional[str] = None
    force_refresh: bool = False
    apply_to_process: bool = False


class ProposalBody(BaseModel):
    title: str
    content_md: str
    source_type: str = "agent"
    source_session_id: Optional[str] = None
    description: Optional[str] = None
    suggested_name: Optional[str] = None
    suggested_category: Optional[str] = None
    source_summary: Optional[str] = None
    suggested_scope: Optional[dict[str, Any]] = None


class ProposalReviewBody(BaseModel):
    review_comment: Optional[str] = None


class ProposalConvertBody(BaseModel):
    name: Optional[str] = None
    display_name: Optional[str] = None
    publish: bool = False


class FeedbackBody(BaseModel):
    skill_id: str
    skill_version_id: Optional[str] = None
    rating: Optional[int] = None
    comment: Optional[str] = None
    status: str = "open"


class TeamBody(BaseModel):
    name: str
    parent_id: Optional[str] = None


class TeamMemberBody(BaseModel):
    user_id: str
    role: str = "member"


class EmployeeBody(BaseModel):
    user_id: str
    display_name: Optional[str] = None
    employee_no: Optional[str] = None
    title: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: str = "active"
    role: str = "member"
    team_ids: Optional[list[str]] = None


class EmployeeSkillBody(BaseModel):
    skill_id: str
    access_level: str = "use"


class GovernanceScanBody(BaseModel):
    content_md: str


MANAGE_ROLES = {"org_admin", "skill_admin"}
REVIEW_ROLES = {"org_admin", "skill_admin", "skill_reviewer"}
ADMIN_ROLES = {"org_admin", "skill_admin"}
TEAM_MANAGE_ROLES = {"org_admin", "skill_admin", "team_admin"}


@router.get("/organizations")
async def list_enterprise_organizations(request: Request):
    user = _actor(request)
    with transaction() as conn:
        return {"organizations": service.list_organizations_for_user(conn, str(user["id"]))}


@router.get("/teams")
async def list_enterprise_teams(request: Request):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"teams": service.list_teams(conn, organization_id)}


@router.post("/teams")
async def create_enterprise_team(request: Request, body: TeamBody):
    user = _enterprise_role(request, TEAM_MANAGE_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"team": service.create_team(
            conn,
            organization_id=organization_id,
            name=body.name,
            parent_id=body.parent_id,
            actor_user_id=str(user["id"]),
        )}


@router.get("/teams/{team_id}/members")
async def list_enterprise_team_members(request: Request, team_id: str):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"members": service.list_team_members(conn, organization_id, team_id)}


@router.post("/teams/{team_id}/members")
async def add_enterprise_team_member(request: Request, team_id: str, body: TeamMemberBody):
    user = _enterprise_role(request, TEAM_MANAGE_ROLES)
    organization_id = _organization_id(request)
    try:
        with transaction() as conn:
            return {"member": service.add_team_member(
                conn,
                organization_id=organization_id,
                team_id=team_id,
                user_id=body.user_id,
                role=body.role,
                actor_user_id=str(user["id"]),
            )}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/employees")
async def list_enterprise_employees(
    request: Request,
    team_id: Optional[str] = None,
    keyword: Optional[str] = None,
    status: Optional[str] = "active",
):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {
            "employees": service.list_employees(
                conn,
                organization_id=organization_id,
                team_id=team_id,
                keyword=keyword,
                status=status,
            )
        }


@router.post("/employees")
async def upsert_enterprise_employee(request: Request, body: EmployeeBody):
    user = _enterprise_role(request, TEAM_MANAGE_ROLES)
    organization_id = _organization_id(request)
    try:
        with transaction() as conn:
            return {
                "employee": service.upsert_employee(
                    conn,
                    organization_id=organization_id,
                    user_id=body.user_id,
                    actor_user_id=str(user["id"]),
                    display_name=body.display_name,
                    employee_no=body.employee_no,
                    title=body.title,
                    phone=body.phone,
                    email=body.email,
                    status=body.status,
                    role=body.role,
                    team_ids=body.team_ids,
                )
            }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/employees/{user_id}")
async def get_enterprise_employee(request: Request, user_id: str):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        employee = service.get_employee(conn, organization_id, user_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"employee": employee}


@router.get("/employees/{user_id}/skills")
async def list_enterprise_employee_skills(request: Request, user_id: str):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        if not service.get_employee(conn, organization_id, user_id):
            raise HTTPException(status_code=404, detail="Employee not found")
        return {"skills": service.list_employee_skills(conn, organization_id, user_id)}


@router.post("/employees/{user_id}/skills")
async def assign_enterprise_employee_skill(request: Request, user_id: str, body: EmployeeSkillBody):
    user = _enterprise_role(request, ADMIN_ROLES)
    organization_id = _organization_id(request)
    try:
        with transaction() as conn:
            return {
                "assignment": service.assign_employee_skill(
                    conn,
                    organization_id=organization_id,
                    user_id=user_id,
                    skill_id=body.skill_id,
                    access_level=body.access_level,
                    actor_user_id=str(user["id"]),
                )
            }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/employees/{user_id}/skills/{skill_id}")
async def remove_enterprise_employee_skill(
    request: Request,
    user_id: str,
    skill_id: str,
    access_level: str = Query("use"),
):
    user = _enterprise_role(request, ADMIN_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return service.remove_employee_skill(
            conn,
            organization_id=organization_id,
            user_id=user_id,
            skill_id=skill_id,
            access_level=access_level,
            actor_user_id=str(user["id"]),
        )


@router.post("/skills/governance/scan")
async def scan_enterprise_skill_governance(request: Request, body: GovernanceScanBody):
    _actor(request)
    findings = scan_skill_content(body.content_md)
    return {
        "findings": [
            {
                "severity": item.level,
                "rule_id": item.code,
                "message": item.message,
                "field": "content_md",
                "suggestion": "请移除敏感信息、越权提示或不适合发布的内容后再提交审核。",
            }
            for item in findings
        ]
    }


@router.get("/skills")
async def list_enterprise_skills(
    request: Request,
    status: Optional[str] = None,
    category: Optional[str] = None,
    keyword: Optional[str] = None,
    scope: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        result = service.list_skills(
            conn,
            organization_id=organization_id,
            status=status,
            category=category,
            keyword=keyword,
            scope=scope,
            page=page,
            page_size=page_size,
        )
        return {"skills": result["items"], **result}


@router.post("/skills")
async def create_enterprise_skill(request: Request, body: SkillCreateBody):
    user = _enterprise_role(request, MANAGE_ROLES)
    organization_id = _organization_id(request)
    visibility = [item.dict() for item in body.visibility] if body.visibility else None
    try:
        with transaction() as conn:
            service.ensure_membership(conn, str(user["id"]), "org_admin", organization_id)
            skill = service.create_skill(
                conn,
                name=body.name,
                content_md=body.content_md,
                actor_user_id=str(user["id"]),
                organization_id=organization_id,
                display_name=body.display_name,
                description=body.description,
                category=body.category,
                business_domain=body.business_domain,
                visibility=visibility,
            )
            if body.publish:
                skill = service.submit_review(conn, skill["id"], str(user["id"]), organization_id)
                skill = service.approve_version(conn, skill["id"], str(user["id"]), organization_id)
                skill = service.publish_version(conn, skill["id"], str(user["id"]), organization_id)
            return {"skill": skill}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/skills/available")
async def available_enterprise_skills(
    request: Request,
    profile_id: Optional[str] = None,
    session_id: Optional[str] = None,
    include_snapshot: bool = True,
):
    user = _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        skills = service.available_skills(
                conn,
                user_id=str(user["id"]),
                organization_id=organization_id,
                profile_id=profile_id,
            )
        payload: dict[str, Any] = {"skills": skills}
        if include_snapshot and session_id:
            snapshot = create_runtime_snapshot(
                conn,
                organization_id=organization_id,
                user_id=str(user["id"]),
                session_id=session_id,
                profile_id=profile_id,
            )
            payload["snapshot"] = snapshot
            payload["snapshot_hash"] = snapshot.get("snapshot_hash")
            payload["locked_version_ids"] = snapshot.get("version_ids", [])
        return payload


@router.post("/skills/proposals")
async def create_enterprise_skill_proposal(request: Request, body: ProposalBody):
    user = _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        proposal = service.create_proposal(
            conn,
            title=body.title,
            content_md=body.content_md,
            proposed_by=str(user["id"]),
            organization_id=organization_id,
            source_type=body.source_type,
            source_session_id=body.source_session_id,
            description=body.description,
            suggested_name=body.suggested_name,
            suggested_category=body.suggested_category,
            source_summary=body.source_summary,
            suggested_scope=body.suggested_scope,
        )
        return {"proposal": proposal}


@router.get("/skills/proposals")
async def list_enterprise_skill_proposals(request: Request, status: Optional[str] = None):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"proposals": service.list_proposals(conn, organization_id=organization_id, status=status)}


@router.get("/skills/proposals/{proposal_id}")
async def get_enterprise_skill_proposal(request: Request, proposal_id: str):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        proposal = service.get_proposal(conn, proposal_id, organization_id)
        if not proposal:
            raise HTTPException(status_code=404, detail="Proposal not found")
        return {"proposal": proposal}


@router.post("/skills/proposals/{proposal_id}/approve")
async def approve_enterprise_skill_proposal(request: Request, proposal_id: str, body: ProposalReviewBody):
    user = _enterprise_role(request, REVIEW_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"proposal": service.review_proposal(
            conn,
            proposal_id=proposal_id,
            actor_user_id=str(user["id"]),
            organization_id=organization_id,
            status="approved",
            review_comment=body.review_comment,
        )}


@router.post("/skills/proposals/{proposal_id}/reject")
async def reject_enterprise_skill_proposal(request: Request, proposal_id: str, body: ProposalReviewBody):
    user = _enterprise_role(request, REVIEW_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"proposal": service.review_proposal(
            conn,
            proposal_id=proposal_id,
            actor_user_id=str(user["id"]),
            organization_id=organization_id,
            status="rejected",
            review_comment=body.review_comment,
        )}


@router.post("/skills/proposals/{proposal_id}/convert")
async def convert_enterprise_skill_proposal(request: Request, proposal_id: str, body: ProposalConvertBody):
    user = _enterprise_role(request, MANAGE_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return service.convert_proposal_to_skill(
            conn,
            proposal_id=proposal_id,
            actor_user_id=str(user["id"]),
            organization_id=organization_id,
            name=body.name,
            display_name=body.display_name,
            publish=body.publish,
        )


@router.get("/skills/usage")
async def list_enterprise_skill_usage(request: Request, skill_id: Optional[str] = None, limit: int = Query(100, ge=1, le=500)):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"events": service.list_usage_events(conn, organization_id=organization_id, skill_id=skill_id, limit=limit)}


@router.get("/skills/feedback")
async def list_enterprise_skill_feedback(request: Request, skill_id: Optional[str] = None, limit: int = Query(100, ge=1, le=500)):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"feedback": service.list_feedback(conn, organization_id=organization_id, skill_id=skill_id, limit=limit)}


@router.post("/skills/feedback")
async def create_enterprise_skill_feedback(request: Request, body: FeedbackBody):
    user = _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"feedback": service.create_feedback(
            conn,
            skill_id=body.skill_id,
            organization_id=organization_id,
            skill_version_id=body.skill_version_id,
            actor_user_id=str(user["id"]),
            rating=body.rating,
            comment=body.comment,
            status=body.status,
        )}


@router.get("/skills/audit")
async def list_enterprise_skill_audit(request: Request, target_id: Optional[str] = None, limit: int = Query(100, ge=1, le=500)):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"logs": service.list_audit_logs(conn, organization_id=organization_id, target_id=target_id, limit=limit)}


@router.get("/skills/{skill_id}")
async def get_enterprise_skill(request: Request, skill_id: str):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        skill = service.get_skill(conn, skill_id, organization_id)
        if not skill:
            raise HTTPException(status_code=404, detail="Skill not found")
        return {"skill": skill}


@router.put("/skills/{skill_id}/draft")
async def update_enterprise_skill_draft(request: Request, skill_id: str, body: SkillDraftBody):
    user = _enterprise_role(request, MANAGE_ROLES)
    organization_id = _organization_id(request)
    try:
        with transaction() as conn:
            skill = service.update_draft(
                conn,
                skill_id=skill_id,
                content_md=body.content_md,
                changelog=body.changelog,
                actor_user_id=str(user["id"]),
                organization_id=organization_id,
            )
            return {"skill": skill}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/skills/{skill_id}/submit-review")
async def submit_enterprise_skill_review(request: Request, skill_id: str):
    user = _enterprise_role(request, MANAGE_ROLES)
    organization_id = _organization_id(request)
    try:
        with transaction() as conn:
            return {"skill": service.submit_review(conn, skill_id, str(user["id"]), organization_id)}
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/skills/{skill_id}/approve")
async def approve_enterprise_skill(request: Request, skill_id: str):
    user = _enterprise_role(request, REVIEW_ROLES)
    organization_id = _organization_id(request)
    try:
        with transaction() as conn:
            return {"skill": service.approve_version(conn, skill_id, str(user["id"]), organization_id)}
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/skills/{skill_id}/reject")
async def reject_enterprise_skill(request: Request, skill_id: str, body: ProposalReviewBody):
    user = _enterprise_role(request, REVIEW_ROLES)
    organization_id = _organization_id(request)
    try:
        with transaction() as conn:
            return {"skill": service.reject_version(conn, skill_id, str(user["id"]), organization_id, review_comment=body.review_comment)}
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/skills/{skill_id}/publish")
async def publish_enterprise_skill(request: Request, skill_id: str):
    user = _enterprise_role(request, ADMIN_ROLES)
    organization_id = _organization_id(request)
    try:
        with transaction() as conn:
            return {"skill": service.publish_version(conn, skill_id, str(user["id"]), organization_id)}
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/skills/{skill_id}/rollback")
async def rollback_enterprise_skill(request: Request, skill_id: str, body: RollbackBody):
    user = _enterprise_role(request, ADMIN_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"skill": service.rollback(conn, skill_id, body.target_version_id, str(user["id"]), organization_id)}


@router.post("/skills/{skill_id}/archive")
async def archive_enterprise_skill_post(request: Request, skill_id: str):
    user = _enterprise_role(request, ADMIN_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return service.archive_skill(conn, skill_id, str(user["id"]), organization_id)


@router.delete("/skills/{skill_id}")
async def archive_enterprise_skill(request: Request, skill_id: str):
    user = _enterprise_role(request, ADMIN_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return service.archive_skill(conn, skill_id, str(user["id"]), organization_id)


@router.get("/skills/{skill_id}/versions")
async def list_enterprise_skill_versions(request: Request, skill_id: str):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"versions": service.list_versions(conn, skill_id, organization_id)}


@router.get("/skills/{skill_id}/visibility")
async def list_enterprise_skill_visibility(request: Request, skill_id: str):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return {"rules": service.list_visibility_rules(conn, skill_id, organization_id)}


@router.put("/skills/{skill_id}/visibility")
async def replace_enterprise_skill_visibility(request: Request, skill_id: str, body: VisibilityRulesBody):
    user = _enterprise_role(request, ADMIN_ROLES)
    organization_id = _organization_id(request)
    rules = [item.dict() for item in body.rules]
    with transaction() as conn:
        return {"rules": service.replace_visibility_rules(
            conn,
            skill_id=skill_id,
            organization_id=organization_id,
            actor_user_id=str(user["id"]),
            rules=rules,
        )}


@router.get("/skills/{skill_id}/files")
async def list_enterprise_skill_files(request: Request, skill_id: str, version_id: Optional[str] = None):
    _actor(request)
    organization_id = _organization_id(request)
    with transaction() as conn:
        skill = service.get_skill(conn, skill_id, organization_id)
        if not skill:
            raise HTTPException(status_code=404, detail="Skill not found")
        return {"files": service.list_files(conn, skill_id, version_id or skill.get("latest_version_id"), organization_id)}


@router.post("/skills/{skill_id}/files")
async def upsert_enterprise_skill_file(request: Request, skill_id: str, body: SkillFileBody):
    user = _enterprise_role(request, ADMIN_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        skill = service.get_skill(conn, skill_id, organization_id)
        if not skill:
            raise HTTPException(status_code=404, detail="Skill not found")
        file = service.upsert_file(
            conn,
            skill_id=skill_id,
            version_id=skill.get("latest_version_id"),
            organization_id=organization_id,
            actor_user_id=str(user["id"]),
            path=body.path,
            content_text=body.content_text,
            object_url=body.object_url,
            mime_type=body.mime_type,
            file_kind=body.file_kind,
        )
        return {"file": file}


@router.delete("/skills/files/{file_id}")
async def delete_enterprise_skill_file(request: Request, file_id: str):
    user = _enterprise_role(request, ADMIN_ROLES)
    organization_id = _organization_id(request)
    with transaction() as conn:
        return service.delete_file(conn, file_id, str(user["id"]), organization_id)


@router.post("/skills/runtime-snapshot")
async def create_enterprise_runtime_snapshot(request: Request, body: RuntimeSnapshotBody):
    user = _actor(request)
    organization_id = _organization_id(request)
    if not body.session_id.strip():
        raise HTTPException(status_code=400, detail="session_id is required")
    with transaction() as conn:
        snapshot = create_runtime_snapshot(
            conn,
            organization_id=organization_id,
            user_id=str(user["id"]),
            session_id=body.session_id.strip(),
            profile_id=body.profile_id,
            force_refresh=body.force_refresh,
        )
    if body.apply_to_process:
        apply_runtime_env(snapshot["runtime_skills_dir"])
    return snapshot
