"""Account Management, Notifications & Permanent Account Deletion Blueprint."""

from __future__ import annotations

from flask import Blueprint, g, request

from services.profile_service import handle_supabase_error
from services.supabase_service import get_secret_client
from utils.auth import require_auth
from utils.errors import NotFoundError, ServiceUnavailableError, ValidationError, success_response
from utils.validators import is_valid_uuid

account_bp = Blueprint("account", __name__)


def _purge_user_storage_bucket(client, bucket_name: str, user_id: str) -> None:
    """Best-effort cleanup of all private storage objects under user's folder prefix."""
    try:
        entries = client.storage.from_(bucket_name).list(user_id)
        if not entries:
            return
        paths_to_remove: list[str] = []
        for entry in entries:
            name = entry.get("name")
            if not name:
                continue
            # Check nested folders (e.g., {user_id}/{cv_id}/{filename})
            if entry.get("id") is None:
                sub_entries = client.storage.from_(bucket_name).list(f"{user_id}/{name}")
                for sub in sub_entries or []:
                    if sub.get("name"):
                        paths_to_remove.append(f"{user_id}/{name}/{sub['name']}")
            else:
                paths_to_remove.append(f"{user_id}/{name}")
        if paths_to_remove:
            client.storage.from_(bucket_name).remove(paths_to_remove)
    except Exception:  # noqa: BLE001
        pass


@account_bp.get("/api/notifications")
@require_auth(require_verified_email=True)
def list_notifications():
    user_id = g.current_user.user_id
    try:
        res = (
            get_secret_client()
            .table("notifications")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(30)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)

    items = res.data or []
    unread_count = sum(1 for item in items if not item.get("is_read"))
    return success_response(
        data={"items": items, "unread_count": unread_count},
        message="Notifications loaded.",
    )


@account_bp.put("/api/notifications/<notif_id>/read")
@require_auth(require_verified_email=True)
def mark_notification_read(notif_id: str):
    if not is_valid_uuid(notif_id):
        raise ValidationError("Invalid notification ID.")
    user_id = g.current_user.user_id
    try:
        res = (
            get_secret_client()
            .table("notifications")
            .update({"is_read": True})
            .eq("id", notif_id)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    if not res.data:
        raise NotFoundError("Notification not found.")
    return success_response(data={"item": res.data[0]}, message="Notification marked as read.")


@account_bp.post("/api/notifications/read-all")
@require_auth(require_verified_email=True)
def mark_all_notifications_read():
    user_id = g.current_user.user_id
    try:
        get_secret_client().table("notifications").update({"is_read": True}).eq("user_id", user_id).eq(
            "is_read", False
        ).execute()
    except Exception as exc:  # noqa: BLE001
        handle_supabase_error(exc)
    return success_response(data={}, message="All notifications marked as read.")


@account_bp.post("/api/account/delete")
@require_auth(require_verified_email=True)
def delete_account():
    """Permanently delete user's private storage files, profile data (via cascade), and Auth account."""
    payload = request.get_json(silent=True) or {}
    confirmation = str(payload.get("confirmation") or "").strip()
    if confirmation != "DELETE":
        raise ValidationError("Type DELETE in uppercase to confirm permanent account deletion.")

    user_id = g.current_user.user_id
    client = get_secret_client()

    _purge_user_storage_bucket(client, "uploaded-cvs", user_id)
    _purge_user_storage_bucket(client, "generated-documents", user_id)

    try:
        client.auth.admin.delete_user(user_id)
    except Exception as exc:  # noqa: BLE001
        raise ServiceUnavailableError(
            "Unable to complete account deletion right now. Please try again shortly."
        ) from exc

    return success_response(
        data={"deleted_user_id": user_id},
        message="Your CareerCraft AI account and associated data have been permanently deleted.",
    )
