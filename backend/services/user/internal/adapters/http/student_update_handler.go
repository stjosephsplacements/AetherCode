package httpadapter

import (
	"net/http"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/httpx"
	"github.com/stjosephsplacements/AetherCode/services/user/internal/app"
)

type updateStudentRequest struct {
	EnrollmentNumber *string `json:"enrollment_number"`
	AdmittedAt       *string `json:"admitted_at"`
}

func (handler *Handler) updateStudent(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	studentID, err := httpx.ParseUUIDPathValue(request, "student_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body updateStudentRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "students", studentID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	student, err := handler.service.UpdateStudent(request.Context(), decision.Capability, app.UpdateStudent{ID: studentID, EnrollmentNumber: body.EnrollmentNumber, AdmittedAt: body.AdmittedAt})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, student)
}
