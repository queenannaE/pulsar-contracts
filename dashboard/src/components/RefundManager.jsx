import React, { useState, useReducer } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const INITIAL_FORM = {
  orderId: '',
  refundId: '',
  amount: '',
  reason: '',
};

const INITIAL_ERRORS = {
  orderId: '',
  refundId: '',
  amount: '',
  reason: '',
};

function validateForm(fields) {
  const errors = { ...INITIAL_ERRORS };
  if (!fields.orderId.trim())   errors.orderId  = 'Order ID is required.';
  if (!fields.refundId.trim())  errors.refundId = 'Refund ID is required.';
  if (!fields.amount || Number(fields.amount) <= 0) {
    errors.amount = 'Amount must be a positive number.';
  }
  if (!fields.reason.trim())    errors.reason   = 'Reason is required.';
  return errors;
}

function hasErrors(errs) {
  return Object.values(errs).some(Boolean);
}

/** Minimal state machine: idle | submitting | success | error */
function statusReducer(_state, action) {
  switch (action.type) {
    case 'SUBMIT':   return { phase: 'submitting', message: null };
    case 'SUCCESS':  return { phase: 'success',    message: action.message };
    case 'ERROR':    return { phase: 'error',      message: action.message };
    case 'RESET':    return { phase: 'idle',       message: null };
    default:         return _state;
  }
}

export default function RefundManager({ merchantAddress }) {
  const [form,       setForm]       = useState(INITIAL_FORM);
  const [errors,     setErrors]     = useState(INITIAL_ERRORS);
  const [status,     dispatch]      = useReducer(statusReducer, { phase: 'idle', message: null });
  const [touched,    setTouched]    = useState({});

  const handleChange = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    if (touched[field]) {
      // Re-validate the touched field on change
      const next = { ...form, [field]: e.target.value };
      const errs = validateForm(next);
      setErrors(prev => ({ ...prev, [field]: errs[field] }));
    }
  };

  const handleBlur = (field) => () => {
    setTouched(t => ({ ...t, [field]: true }));
    const errs = validateForm(form);
    setErrors(prev => ({ ...prev, [field]: errs[field] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const allTouched = Object.keys(INITIAL_FORM).reduce((a, k) => ({ ...a, [k]: true }), {});
    setTouched(allTouched);
    const errs = validateForm(form);
    setErrors(errs);
    if (hasErrors(errs)) return;

    dispatch({ type: 'SUBMIT' });
    try {
      const body = {
        caller:     merchantAddress,
        refund_id:  form.refundId.trim(),
        order_id:   form.orderId.trim(),
        amount:     Number(form.amount),
        reason:     form.reason.trim(),
      };
      const res = await fetch(`${API}/refunds`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server responded ${res.status}`);
      }
      dispatch({ type: 'SUCCESS', message: `Refund ${form.refundId} initiated successfully.` });
      setForm(INITIAL_FORM);
      setTouched({});
    } catch (err) {
      dispatch({ type: 'ERROR', message: err.message });
    }
  };

  const handleReset = () => {
    setForm(INITIAL_FORM);
    setErrors(INITIAL_ERRORS);
    setTouched({});
    dispatch({ type: 'RESET' });
  };

  return (
    <section aria-labelledby="refund-heading">
      <h2 id="refund-heading">Refund Management</h2>

      {status.phase === 'success' && (
        <div role="status" aria-live="polite" className="alert alert-success">
          {status.message}
        </div>
      )}
      {status.phase === 'error' && (
        <div role="alert" aria-live="assertive" className="alert alert-error">
          {status.message}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        aria-label="Initiate refund"
        noValidate
        style={{ maxWidth: '480px' }}
      >
        {/* Order ID */}
        <div className="form-group">
          <label htmlFor="orderId">
            Order ID <span className="required" aria-hidden="true">*</span>
          </label>
          <input
            id="orderId"
            type="text"
            value={form.orderId}
            onChange={handleChange('orderId')}
            onBlur={handleBlur('orderId')}
            required
            aria-required="true"
            aria-invalid={Boolean(errors.orderId) || undefined}
            aria-describedby={errors.orderId ? 'orderId-error' : undefined}
            placeholder="ORDER_001"
          />
          {errors.orderId && (
            <p id="orderId-error" className="field-error" role="alert">{errors.orderId}</p>
          )}
        </div>

        {/* Refund ID */}
        <div className="form-group">
          <label htmlFor="refundId">
            Refund ID <span className="required" aria-hidden="true">*</span>
          </label>
          <input
            id="refundId"
            type="text"
            value={form.refundId}
            onChange={handleChange('refundId')}
            onBlur={handleBlur('refundId')}
            required
            aria-required="true"
            aria-invalid={Boolean(errors.refundId) || undefined}
            aria-describedby={errors.refundId ? 'refundId-error' : undefined}
            placeholder="REFUND_001"
          />
          {errors.refundId && (
            <p id="refundId-error" className="field-error" role="alert">{errors.refundId}</p>
          )}
        </div>

        {/* Amount */}
        <div className="form-group">
          <label htmlFor="amount">
            Amount <span className="required" aria-hidden="true">*</span>
          </label>
          <input
            id="amount"
            type="number"
            min="1"
            step="1"
            value={form.amount}
            onChange={handleChange('amount')}
            onBlur={handleBlur('amount')}
            required
            aria-required="true"
            aria-invalid={Boolean(errors.amount) || undefined}
            aria-describedby={errors.amount ? 'amount-error' : undefined}
            placeholder="500"
          />
          {errors.amount && (
            <p id="amount-error" className="field-error" role="alert">{errors.amount}</p>
          )}
        </div>

        {/* Reason */}
        <div className="form-group">
          <label htmlFor="reason">
            Reason <span className="required" aria-hidden="true">*</span>
          </label>
          <input
            id="reason"
            type="text"
            value={form.reason}
            onChange={handleChange('reason')}
            onBlur={handleBlur('reason')}
            required
            aria-required="true"
            aria-invalid={Boolean(errors.reason) || undefined}
            aria-describedby={errors.reason ? 'reason-error' : undefined}
            placeholder="Customer request"
          />
          {errors.reason && (
            <p id="reason-error" className="field-error" role="alert">{errors.reason}</p>
          )}
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={status.phase === 'submitting'}
            aria-disabled={status.phase === 'submitting'}
          >
            {status.phase === 'submitting' ? 'Submitting…' : 'Initiate Refund'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            disabled={status.phase === 'submitting'}
          >
            Reset
          </button>
        </div>
      </form>
    </section>
  );
}
