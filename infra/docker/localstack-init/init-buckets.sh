#!/usr/bin/env bash
# Init hook do LocalStack (roda dentro do container quando o S3 emulado fica
# pronto — ver ADR-0015). Cria os buckets usados por apps/api em dev/CI.
set -euo pipefail

awslocal s3 mb "s3://${BUCKET_PLATE_IMAGES}" 2>/dev/null || true
awslocal s3 mb "s3://${BUCKET_REPORTS}" 2>/dev/null || true

echo "Buckets prontos: ${BUCKET_PLATE_IMAGES} e ${BUCKET_REPORTS}."
